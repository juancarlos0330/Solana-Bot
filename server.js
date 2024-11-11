require('./dotenv-flow')

const port = 8755
const path = require('path')
const express = require('express')
const app = express()
const bs58 = require('bs58')
const { Connection, 
    Keypair, 
    clusterApiUrl, 
    PublicKey, 
    SystemProgram, 
    Transaction, 
    sendAndConfirmTransaction, 
    LAMPORTS_PER_SOL } = require('@solana/web3.js')
const Database = require("better-sqlite3")
//const sqlite3 = require('sqlite3').verbose();
const db = new Database("sqlite-database.db")
//const db = new sqlite3.Database("sqlite-database.db")
const terminate = require('terminate')
const childProcess = require('child_process')
const http = require('http')
const fs = require('fs')
const server = http.createServer(app)
const { Server } = require("socket.io")
const { Wallet } = require("@project-serum/anchor")
const b58 = require('bs58');

const io = new Server(server)
const {
	setup,
    decryptMessage,
    getUserByPubkey,
    encryptAndStorePrivateKey,
    getTrades,
    sellToken,
    getRPC,
} = require('./server-functions')

const web3 = require('@solana/web3.js')

let solanaPrice = 100
let myProcess = null
let connectedSocketIds = []

// const wallets = [
//     new PhantomWalletAdapter(),
//     new SolflareWalletAdapter()
// ]
//initWallet({ wallets, autoConnect: true });

const intervalSolanaPrice = () => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
        .then(response => response.json())
        .then(data => {
            if (data && data.solana && data.solana.usd) {
                const solPrice = data.solana.usd
                solanaPrice = solPrice
                console.log('Current price of SOL:', solPrice)
            }
        })
        .catch(error => {
            console.error('Error fetching SOL price:', error)
        })
    setInterval(() => {
        fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
        .then(response => response.json())
        .then(data => {
            if (data && data.solana && data.solana.usd) {
                const solPrice = data.solana.usd
                solanaPrice = solPrice
                console.log('Current price of SOL:', solPrice)
            }
        })
        .catch(error => {
            console.error('Error fetching SOL price:', error)
        })
    }, 60e3) // Every minute
}

const createConnectButton = () => {

}

const restartProcess = () => {
    if (myProcess) terminate(myProcess.pid) 
    // const cmd = `NODE_ENV=${process.env.NODE_ENV} NODE_NO_WARNINGS=1 forever --minUptime 1000 --spinSleepTime 1000 sniper.js >> ./logs/logs_all.txt 2>&1`
    // const cmd = `cross-env NODE_ENV=${process.env.NODE_ENV} forever --minUptime 1000 --spinSleepTime 1000 sniper.js >> ./logs/logs_all.txt 2>&1`
    //const cmd = `node sniper.js >> ./logs/logs_all.txt 2>&1`
    const cmd = `forever --minUptime 1000 --spinSleepTime 1000 sniper.js >> ./logs/logs_all.txt 2>&1`
    console.log(cmd)
    myProcess = childProcess.exec(cmd)
}

app.use(express.static('dist'))
app.use(express.json())
app.use('*', (req, res, next) => {
	const time = new Date()
	const ip = req.headers['x-real-ip'] || req.ip
	console.log(`${req.method} from ${ip} to ${req.originalUrl} at ${time.getHours()}:${time.getMinutes()}:${time.getSeconds()}`)
	next()
})

app.get('/logo', (req, res) => {
    
})

app.get('/tg/:username', (req, res) => {
    try {
        const existingUsername = db.prepare('SELECT username FROM telegramChannels WHERE username = ?').get(req.params.username)
        if (!existingUsername) {
            db.prepare(
                'INSERT INTO telegramChannels (username) VALUES (@username)'
            ).run({
                username: req.params.username,
            })
        }
        res.json({ok: true})
    } catch (e) {
        res.json({ok: false})
    } 
})

app.get('/remove-tg/:username', (req, res) => {
    try {
        const existingUsername = db.prepare('SELECT username FROM telegramChannels WHERE username = ?').get(req.params.username)
        if (existingUsername) {
            db.prepare(
                'DELETE FROM telegramChannels WHERE username = ?'
            ).run(req.params.username)
        } else {
            return res.json({ok: false, error: "That username hasn't been added"})
        }
        res.json({ok: true})
    } catch (e) {
        res.json({ok: false, error: e})
    } 
})

app.get('/tgs', (req, res) => {
    const tgs = db.prepare('SELECT * FROM telegramChannels').all()
    res.json({ tgs })
})

app.post('/create-wallet', (req, res) => {
    const response = encryptAndStorePrivateKey(req.body.privateKey, req.body.publicKey)
    res.json(response)
})

app.get('/save-user/:publicKey', async (req, res) => {
    const publicKey = req.params.publicKey
    if(publicKey) { // 
        try {
            // Add user to db
            const isNew = db.prepare('SELECT * FROM users WHERE pubkey=@pubkey').get({ pubkey: publicKey })
            if(!isNew) {
                db.prepare(`INSERT INTO users (pubkey) VALUES (@pubkey)`).run({ pubkey: publicKey })
            }
            // Get last created wallet private key and balance
            const user = getUserByPubkey(publicKey)
            const latestWallet = db.prepare('SELECT encodedPrivateKey FROM wallets WHERE userId=@userId ORDER BY id DESC LIMIT 1')
                .get({ userId: user.userId })
            if(!latestWallet) // No wallet for this user
                return res.json({ ok: false, error: 'No Wallet. Create new wallet please.' })
            const decoded = decryptMessage(latestWallet.encodedPrivateKey, process.env.ENCODING_SEED)
            const connection = new Connection(getRPC())
            const wallet = Keypair.fromSecretKey(bs58.decode(decoded)) // Store globally
            const balance = await connection.getBalance(wallet.publicKey)
            res.json({
                ok: true,
                privateKey: decoded,
                balance,
            })
        } catch (e) {
            res.json({ ok: false, error: e })
        }
    }
    return { ok: false }
})

app.get('/get-wallet', async (req, res) => {
    try {
        const latestWallet = db.prepare('SELECT encodedPrivateKey FROM wallets ORDER BY id DESC LIMIT 1').get()
        if (!latestWallet) {
            return res.json({ok: false, error: 'No wallet'})
        }
        const decoded = decryptMessage(latestWallet.encodedPrivateKey, process.env.ENCODING_SEED)
        const connection = new Connection(getRPC())
        const wallet = Keypair.fromSecretKey(bs58.decode(decoded)) // Store globally
        const balance = await connection.getBalance(wallet.publicKey)
        res.json({
            ok: true,
            privateKey: decoded,
            balance,
        })
    } catch (e) {
        res.json({ok: false, error: e})
    } 
})

app.post('/settings', (req, res) => {
    try {
        const existingSettings = db.prepare('SELECT * FROM settings').get()
        if (existingSettings) {
            console.log('Settings existing')
            db.prepare(`UPDATE settings SET 
                amountPerTrade = @amountPerTrade,
                maxSlippagePercentage = @maxSlippagePercentage,
                isAutoTradingActivated = @isAutoTradingActivated,
                lockInProfits = @lockInProfits,
                stopLossPercentage = @stopLossPercentage,
                trailingStopLossPercentageFromHigh = @trailingStopLossPercentageFromHigh,
                percentageToTakeAtTrailingStopLoss = @percentageToTakeAtTrailingStopLoss
                WHERE singleton = 1`).run({
                    amountPerTrade: req.body.amountPerTrade,
                    maxSlippagePercentage: req.body.maxSlippagePercentage,
                    isAutoTradingActivated: req.body.isAutoTradingActivated,
                    lockInProfits: req.body.lockInProfits,
                    stopLossPercentage: req.body.stopLossPercentage,
                    trailingStopLossPercentageFromHigh: req.body.trailingStopLossPercentageFromHigh,
                    percentageToTakeAtTrailingStopLoss: req.body.percentageToTakeAtTrailingStopLoss,
            })
        } else {
            console.log('Inserting settings')
            db.prepare(`INSERT INTO settings VALUES (
                @amountPerTrade,
                @maxSlippagePercentage,
                @isAutoTradingActivated,
                @lockInProfits,
                @stopLossPercentage,
                @trailingStopLossPercentageFromHigh,
                @percentageToTakeAtTrailingStopLoss,
                @rpc,
                @singleton
            )`).run({
                    amountPerTrade: req.body.amountPerTrade,
                    maxSlippagePercentage: req.body.maxSlippagePercentage,
                    isAutoTradingActivated: req.body.isAutoTradingActivated,
                    lockInProfits: req.body.lockInProfits,
                    stopLossPercentage: req.body.stopLossPercentage,
                    trailingStopLossPercentageFromHigh: req.body.trailingStopLossPercentageFromHigh,
                    percentageToTakeAtTrailingStopLoss: req.body.percentageToTakeAtTrailingStopLoss,
                    rpc: req.body.rpc,
                    singleton: 1,
            })
        }
        res.json({ok: true})
    } catch (e) {
        console.log('Error settings', e)
        res.json({ok: false})
    }
})

app.get('/solana-price', (req, res) => {
    res.json({solanaPrice})
})

app.get('/start', (req, res) => {
    console.log('Starting')
    const existingBotActive = db.prepare('SELECT * FROM botActive').get()
    if (existingBotActive) {
        console.log('botActive existing')
        db.prepare(`UPDATE botActive SET isActive = @isActive`).run({ isActive: 1 })
    } else {
        console.log('Inserting botActive')
        db.prepare(`INSERT INTO botActive (isActive) VALUES (@isActive)`).run({ isActive: 1 })
    }
    console.log("starting listeneing")
    restartProcess()
    res.json({ok: true})
})

app.get('/stop', (req, res) => {
    console.log('Stopping')
    const existingBotActive = db.prepare('SELECT * FROM botActive').get()
    if (existingBotActive) {
        console.log('botActive existing')
        db.prepare(`UPDATE botActive SET isActive = @isActive`).run({ isActive: 0 }) // False
    } else {
        console.log('Inserting botActive')
        db.prepare(`INSERT INTO botActive (isActive) VALUES (@isActive)`).run({ isActive: 0 }) // False
    }
    restartProcess()
    res.json({ok: true})
})

app.post('/transfer', async (req, res) => {
    try {
        const publicKey = req.body.publicKey
        const amount = req.body.amount
        const user = getUserByPubkey(publicKey)
        const latestWallet = db.prepare('SELECT encodedPrivateKey FROM wallets WHERE userId=@userId ORDER BY id DESC LIMIT 1')
            .get({ userId: user.userId })
        if(!latestWallet) // No wallet for this user
            return res.json({ ok: false, error: 'No Wallet' })
        const decoded = decryptMessage(latestWallet.encodedPrivateKey, process.env.ENCODING_SEED)
        const wallet = Keypair.fromSecretKey(bs58.decode(decoded)) // Store globally
        const connection = new Connection(getRPC())
        const balance = await connection.getBalance(wallet.publicKey)
        console.log('LAMPORTS_PER_SOL * amount', LAMPORTS_PER_SOL * amount)
        console.log('balance', balance)
        if(LAMPORTS_PER_SOL * amount >= balance) return res.json({ ok: false, error: 'Insufficient sol balance' })
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: new PublicKey(publicKey),
                lamports: LAMPORTS_PER_SOL * amount
            }),
        )
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [wallet]
        )
        return res.json({ ok: true, signature })
    } catch (e) {
        return res.json({ ok: false, error: 'Insufficient sol balance for fee' })
    }
})

app.get('/get-settings', (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').get()
    if(!settings) return res.json({ ok: false })
    res.json({ ok: true, settings })
})

app.get('/get-trades/:pubkey', async (req, res) => {
    const tradesResponse = await getTrades(req.params.pubkey)
    res.json(tradesResponse) // The result is already json whether there's an error error or not
})

app.get('/sell/:publickey/:id', async (req, res) => {
    console.log("This is FIVE");
    res.json(await sellToken(req.params.id, 100, false, req.params.publickey))
})

app.post('/set-rpc', async (req, res) => {
    console.log('req.body.rpc', req.body.rpc)
    if (!req.body.rpc || req.body.rpc.length == 0) return res.json({ok: false})
    const response = db.prepare('UPDATE settings SET rpc=@rpc').run({rpc: req.body.rpc})
    console.log('response', response)
    res.json({ok: true})
})

io.on('connection', (socket) => {
    console.log('A user connected', socket.id)
    connectedSocketIds.push(socket.id)
    fs.readFile(logsPath, 'utf8', (err, data) => {
        if (err) return console.error('Error reading file:', err)
        io.to(socket.id).emit('new-log', data)
    })

    socket.on('disconnect', () => {
        console.log('A user disconnected', socket.id)
        connectedSocketIds.splice(connectedSocketIds.indexOf(socket.id), 1)
    })
})

if(!fs.existsSync('logs')) {
    fs.mkdir('logs', (err) => {
        if(err) throw err;
    })
}

const logsPath = path.join(__dirname, 'logs', 'logs_all.txt')
if (!fs.existsSync(logsPath)) {
    fs.writeFileSync(logsPath, '')
}
fs.watchFile(logsPath, () => {
    fs.readFile(logsPath, 'utf8', (err, data) => {
        if (err) return console.error('Error reading file:', err)
        connectedSocketIds.forEach(socketId => {
            io.to(socketId).emit('new-log', data)
        })
    })
})

setup().then(() => {
    intervalSolanaPrice()
    restartProcess()

    server.listen(port, () => {
        console.log(`Server is running on port ${port}`)
    })
})
