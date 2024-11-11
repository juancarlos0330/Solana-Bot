const { NewMessage } = require('telegram/events')
const { TelegramClient, Api } = require('telegram')
const { StoreSession } = require('telegram/sessions')
const input = require('input')
const bs58 = require('bs58')
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js')
const { TOKEN_PROGRAM_ID } = require('@raydium-io/raydium-sdk')
const fs = require('fs')
const fsPromises = require('fs/promises')
const path = require('path')
const Database = require("better-sqlite3")
//const sqlite3 = require('sqlite3').verbose();
const db = new Database("sqlite-database.db")
const {
    decryptPrivateKey,
    getPoolKeys,
    getTrades,
    sellToken,
    swapJupyter,
    getTokenBalance,
    getTokenData,
    getRPC,
} = require('./server-functions')
const SOL = 'So11111111111111111111111111111111111111112'

const apiId = 5985128
const apiHash = 'aa4476fa599f9f0ba58a00a9203f3cac'
const stringSession = new StoreSession('telegram-session') // Stores the session in the folder telegram-session

let raydiumLiquidity = null;
let solanaPrice = 100
let pubkey = null;

const login = async () => {
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 10,
    })
    await client.start({
        phoneNumber: async () => 
            await input.text('Please enter your number: '),
        password: async () =>
            await input.text('Please enter your password: '),
        phoneCode: async () =>
            await input.text('Please enter the code you received: '),
        onError: err => {
            console.log('Error client telegram:', err)
        },
    })
    console.log('You should now be connected.')
    // await client.sendMessage('me', { message: 'Hello what up!' })
    return client
}

const getTelegramChannelsToWatch = () => {
    const results = db.prepare('SELECT * FROM telegramChannels').all()
    return results.map(item => item.username)
}

const extractTokenToSnipe = message => {
    /*
    Works for:
        https://dexscreener.com/solana/7c1GCNc23CmoYVGcETxR2UN6F4dfsHh2WmCEBLUTdNrp
        https://birdeye.so/token/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn?chain=solana
        https://birdeye.so/token/4nBdirGQHybv1nYQrsnKZsMWBvChWYx7ejvAgrGEgepV/BZCzRDpTohgX4iKhyHZBHPe1oMoEXzpKKU99NUFqvYdB?chain=solana
    */
    const dexscreenerRegex = /dexscreener\.com\/solana\/(.{44})/i
    const birdeyeRegex = /birdeye\.so\/token\/(.+)\?chain=solana/i
    const matchBirdeye = birdeyeRegex.exec(message)
    const matchScreener = dexscreenerRegex.exec(message)
    pubkey = matchBirdeye.input.split(" ")[1]
    matchBirdeye.input = matchBirdeye.input.split(" ")[0]
    let tokenToBuy = null
    if (matchScreener) {
        tokenToBuy = matchScreener[1]
    } else if (matchBirdeye) {
        tokenToBuy = matchBirdeye[1]
        if (matchBirdeye[1].split('/').length > 1) { // The capture group
            tokenToBuy = matchBirdeye[1].split('/')[1]
        }
    }
    return tokenToBuy
}

let currentlyBuying = {}
let activeIntervals = {}
let intervalPiece = 0 // Increases after each interval
/// Buys the specified token if you haven't purchased the token already
/// Returns false if you already hold the token (it won't buy then)
/// Docs: Tries to buy once then it checks 3 times after an interval of 30 seconds in between. If the tokens
/// aren't detected then, it will buy again and check 3 more times. If we don't get the tokens then it will stop
const buyTokenIfNotAlready = async tokenToBuy => {
    const privateKey = decryptPrivateKey(pubkey)
	if (!privateKey || !privateKey.ok) return
	const byteArray = bs58.decode(privateKey.decoded)
	const wallet = Keypair.fromSecretKey(byteArray)
    const ownerAddress = wallet.publicKey.toBase58()
    const settings = db.prepare('SELECT * FROM settings').get()
    const connection = new Connection(getRPC())
    console.log('ab')
    const tokenAccs = await connection.getParsedTokenAccountsByOwner(
		new PublicKey(ownerAddress),
		{ programId: TOKEN_PROGRAM_ID }	
    )
    console.log('a')
    const tokensNonZeroBalance = tokenAccs.value.filter(item => {
        return item.account.data.parsed.info.tokenAmount.uiAmount != 0
    }).map(item => {
        return item.account.data.parsed.info.mint.toLowerCase()
    })
    console.log('b')
    try {
        raydiumLiquidity = await fsPromises.readFile(
            path.join(__dirname, 'mainnet.json'),
            'utf-8'
        )
    } catch (e) {
        console.log('Error getting raydium liquidity')
        return { ok: false }
    }
    console.log('c')
    const rqJSON = JSON.parse(raydiumLiquidity)
    const results = getPoolKeys(tokenToBuy, rqJSON)
    
    if (!results || !results.pool || !results.pool.baseMint || !results.pool.quoteMint) {
        return console.log('Pool not found, skipping this token purchase')
    }
    
    const tokenDetected = String(results.pool.baseMint) == SOL ? String(results.pool.quoteMint) : String(results.pool.baseMint)
    if (currentlyBuying[tokenDetected]) return console.log('Already in the process of buying token', tokenDetected)

    if (results.pool && (
            tokensNonZeroBalance.includes(String(results.pool.baseMint).toLowerCase())
            || tokensNonZeroBalance.includes(String(results.pool.quoteMint).toLowerCase())
        )
    ) {
        console.log('Token found, you already have it.')
        return false
    } else {
        console.log("You don't have this token, buying it right now...")
        console.log('Amount to buy in SOL', settings.amountPerTrade)
        // let response = await swapSolToToken(byteArray, settings.amountPerTrade, settings.maxSlippagePercentage, tokenToBuy, true, rqJSON) // change amount here
        let response = await swapJupyter(decryptPrivateKey(pubkey).decoded, SOL, tokenDetected, settings.amountPerTrade * 1e9, settings.maxSlippagePercentage)
        console.log('Response sniper purchase', response)
        
        if (!response || !response.ok) { // Error buying
            console.log("Coundn't get a quote, stopping")
            return { ok: false }
        }
        currentlyBuying[tokenDetected] = true
        let tokenReceived = await getTokenBalance(wallet.publicKey, tokenDetected)
        console.log('Token received first check', tokenReceived)

        let intervalCounter = 0
		intervalPiece++
		const myInterCount = intervalPiece
        if (!tokenReceived) {
            console.log('Tokens not received, starting interval every 10 times, 3 seconds each')
            // Set an interval to check 5 times if the tokens are received 
            const interval = setInterval(async () => {
                console.log('Checking tokens received try', intervalCounter, 'out of', 10, 'tries for:', tokenDetected)

                intervalCounter++
                tokenReceived = await getTokenBalance(wallet.publicKey, tokenDetected)
                console.log('Token received second check', tokenReceived)
                if (tokenReceived) {
                    console.log('Tokens received, storing in the database')
                    clearInterval(activeIntervals[myInterCount])
                    currentlyBuying[tokenDetected] = false
                    try {
                        const tokenData = await getTokenData(tokenDetected)
                        console.log('Token data', tokenData)
                        const dataToStore = {
                            walletId: privateKey.id,
                            txid: response.txid,
                            symbol: response.symbol || tokenData.symbol,
                            address: tokenDetected,
                            decimals: response.decimals || tokenData.decimals,
                            solSpent: response.solSpent,
                            tokensReceived: tokenReceived.amount,
                        }
                        console.log('Data to store', dataToStore)
                        db.prepare(`INSERT INTO trades (walletId, txid, symbol, address, decimals, solSpent, tokensReceived
                        ) VALUES (@walletId, @txid, @symbol, @address, @decimals, @solSpent, @tokensReceived)`).run(dataToStore)
                    } catch (e) { 
                        console.log('Error saving trade', e)
                        return { ok: false }
                    }
                } else if (intervalCounter >= 10) {
                    console.log("Enough tries, the token", tokenDetected, "wasn't detected.")

                    clearInterval(activeIntervals[myInterCount])
                    currentlyBuying[tokenDetected] = false
                }
            }, 5e3)
            activeIntervals[myInterCount] = interval
        } else {
            currentlyBuying[tokenDetected] = false
            console.log('Tokens received, storing in the database')
            try {
                db.prepare(`INSERT INTO trades (walletId, txid, symbol, address, decimals, solSpent, tokensReceived
                ) VALUES (@walletId, @txid, @symbol, @address, @decimals, @solSpent, @tokensReceived)`).run({
                    walletId: privateKey.walletId,
                    txid: response.txid,
                    symbol: response.symbol,
                    address: tokenDetected,
                    decimals: response.decimals,
                    solSpent: response.solSpent,
                    tokensReceived: tokenReceived.amount,
                })
            } catch (e) { 
                console.log('Error saving trade', e) 
                return { ok: false }
            }
        }
    }
}

const setMessagesListener = async (client, channels) => {
    console.log('Setting messages listener')
    console.log('channel: ' + channels);
    async function handler(e) {
        console.log('New message detected in a group')
        const message = e.message.message
        const chatId = e.message.peerId
        console.log("chatId: ", chatId);
        const chatData = await client.invoke(new Api.channels.GetFullChannel({ channel: chatId }))
        
        let channelNamesFound = []
        for (const chat of chatData.chats) {
//            console.log("Chat: ", chat);
            if (chat.username) {
                channelNamesFound.push('@'+chat.username)
                console.log(message);
            }
        }
        
        // Check if the message is in the watched groups
        if (channelNamesFound.some(element => channels.includes(element))) {
            console.log('New message detected in this group:', channelNamesFound)
            const tokenToBuy = extractTokenToSnipe(message)
            if (!tokenToBuy) return // No token found
            console.log('Token to buy detected', tokenToBuy)
            
            // Buys the token mentioned
            return buyTokenIfNotAlready(tokenToBuy)
        }
    }

    // const dexscreenerRegex = /dexscreener\.com\/solana\/(.{44})/i
    // const birdeyeRegex = /birdeye\.so\/token\/(.+)\?chain=solana/i
    client.addEventHandler(handler, new NewMessage({}))
}

const joinChannel = async (client, channelUsername) => {
    const result = await client.invoke(new Api.channels.JoinChannel({
        channel: channelUsername
    }))
    return result
}

const leaveChannel = async (client, channelUsername) => {
    const result = await client.invoke(new Api.channels.LeaveChannel({
        channel: channelUsername
    }))
    return result
}

const updateMainnetData = async () => {
    console.log('Updating raydium pairs data...')
    const req = await fetch('https://api.raydium.io/v2/sdk/liquidity/mainnet.json')
    if (!req.ok) return // We're being rate-limited
    const res = await req.json()
    raydiumLiquidity = JSON.stringify(res)
    fs.writeFile(path.join(__dirname, 'mainnet-temp.json'), raydiumLiquidity, {flag: 'w'}, (err) => {
        if (err) console.log('err', err)
    })
    console.log('Overriding mainnet.json')
    // Move the file to the proper one
    fs.renameSync(path.join(__dirname, 'mainnet-temp.json'), path.join(__dirname, 'mainnet.json'))
    console.log('Overriding mainnet.json done')
    console.log('Done updating')
}

const getOrInsertMonitoringData = item => {
    let monitoringData = db.prepare('SELECT * FROM tradeMonitoring WHERE idAssociatedTrade=@idAssociatedTrade').get({idAssociatedTrade: item.id})
    if (!monitoringData) {
        monitoringData = {
            idAssociatedTrade: item.id,
            highestProfitPercentage: item.unrealizedProfitPercentage,
            highestProfitValue: item.unrealizedProfit, // Half of the solana you spent
        }
        db.prepare(`INSERT INTO tradeMonitoring (idAssociatedTrade, highestProfitPercentage, highestProfitValue)
            VALUES (@idAssociatedTrade, @highestProfitPercentage, @highestProfitValue)`).run(monitoringData)
    }
    return monitoringData
}

const updateTradeMonitoring = item => {
    db.prepare(`UPDATE tradeMonitoring 
        SET highestProfitPercentage = @highestProfitPercentage, highestProfitValue = @highestProfitValue
        WHERE idAssociatedTrade = @idAssociatedTrade`).run({
        idAssociatedTrade: item.id,
        highestProfitPercentage: item.unrealizedProfitPercentage,
        highestProfitValue: item.unrealizedProfit, // Half of the solana you spent
    })
}

// Read docs on monitoring-docs.txt
/// 1. Every minute get the trades
/// 2. Check the unrealized profit and see how far they are from the stop loss
/// 3. Execute stop losses when needed
/// 4. It also monitors trailing stop losses and takes profits when hit
const watcherStopLossAndTakeProfit = () => {
//    let flag = false;
    setInterval(async () => {
//        if(flag == false) {
//            flag = true;
            const settings = db.prepare('SELECT * FROM settings').get()
            const responseTrades = await getTrades(pubkey)
            if (!responseTrades || !responseTrades.ok) return
            responseTrades.trades.forEach(async item => {
                if (item.unrealizedProfitPercentage <= -settings.stopLossPercentage) {
                    console.log('First')
                    return await sellToken(item.id, 100, false, pubkey)
                } else if (
                    settings.lockInProfits &&
                    !item.lockedInProfits &&
                    item.unrealizedProfitPercentage >= 100) { // If you've doubled your money, sell half and keep the rest running
                    console.log('Second')
                    return await sellToken(item.id, 50, true, pubkey)
                } else if (
                    (settings.lockInProfits && item.lockedInProfits) || !settings.lockInProfits
                ) {
                    // Monitor trailing stop losses
                    const monitoringData = getOrInsertMonitoringData(item)
                    if (item.unrealizedProfitPercentage < monitoringData.highestProfitPercentage) { // If we may hit a trailing stop loss
                        const distanceFromTrailingSL = monitoringData.highestProfitPercentage - item.unrealizedProfitPercentage // previous highest point - current point in price 
                        // Trailing stop loss hit, skim a take profit and move the trailing stop loss down
                        if (distanceFromTrailingSL >= settings.trailingStopLossPercentageFromHigh) {
                            console.log('Third')
                            const responseSell = await sellToken(item.id, settings.percentageToTakeAtTrailingStopLoss, false, pubkey) // Take some off
                            if (responseSell.ok) {
                                // Update monitoring
                                updateTradeMonitoring(item)
                            } else { console.log('Response sell trailing stop loss failed', responseSell) }
                        }
                    } else {
                        // Current price is higher than the previous point, so we push the trailing stop loss up
                        updateTradeMonitoring(item)
                    }
                }
            })
//            flag = false;
//        }
    }, 7e3)
}

const start = async () => {
    const mainnetPath = path.join(__dirname, 'mainnet.json')
    if (!fs.existsSync(mainnetPath)) {
        await updateMainnetData()
    }
    raydiumLiquidity = fs.readFileSync(path.join(__dirname, 'mainnet.json'), 'utf-8')

    const connection = new Connection(getRPC())
    const privateKey = decryptPrivateKey(pubkey)
	if (!privateKey || !privateKey.ok) {} else {
        const byteArray = bs58.decode(privateKey.decoded)
        const wallet = Keypair.fromSecretKey(byteArray)
        const balance = await connection.getBalance(wallet.publicKey)
        console.log('Using wallet', wallet.publicKey.toBase58(), 'balance', balance)
    }

    // watcherRaydiumPairLiquidity()
    watcherStopLossAndTakeProfit()

    const client = await login()
    const channels = getTelegramChannelsToWatch()
    console.log('Channels', channels)

    console.log('Joining channels...')
    await Promise.all(channels.map(async item => {
        await joinChannel(client, item.substring(1)); // Remove the @
    }))

    console.log('Now listening for calls on the watched groups')
    const response = db.prepare('SELECT * FROM botActive').get()
    if (response && response.isActive == 1) { // Is active
        await setMessagesListener(client, channels)
    }
}

start()

/*
    1. See what tokens the user has
    2. Watch out for telegram calls
    3. Simulate a call to one of my channels
    4. Execute a buy on that channel
    5. Profit?
*/
