const web3 = require('@solana/web3.js')
const { Client, UtlConfig } = require('@solflare-wallet/utl-sdk')
const {
	Liquidity,
    TokenAmount,
	Token,
	Percent,
	TOKEN_PROGRAM_ID,
	SPL_ACCOUNT_LAYOUT,
	TxVersion,
}  = require('@raydium-io/raydium-sdk')
const { getPoolKeys } = require('./server-functions.js')

const config = new UtlConfig({
	chainId: 101,
	timeout: 2000,
	connection: new web3.Connection('https://api.mainnet-beta.solana.com/'),
	apiUrl: "https://token-list-api.solana.cloud",
	cdnUrl: "https://cdn.jsdelivr.net/gh/solflare-wallet/token-list/solana-tokenlist.json"
})
const utl = new Client(config)

async function calcAmountOut(
	connection,
	poolKeys,
	rawAmountIn,
	slippageData,
	swapInDirection,
) {
	const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys })
	let currencyInMint = poolKeys.baseMint
	let currencyInDecimals = poolInfo.baseDecimals
	let currencyOutMint = poolKeys.quoteMint
	let currencyOutDecimals = poolInfo.quoteDecimals

	if (!swapInDirection) {
		currencyInMint = poolKeys.quoteMint
		currencyInDecimals = poolInfo.quoteDecimals
		currencyOutMint = poolKeys.baseMint
		currencyOutDecimals = poolInfo.baseDecimals
	}

	const currencyIn = new Token(
		TOKEN_PROGRAM_ID,
		currencyInMint,
		currencyInDecimals
	)
	const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
	const currencyOut = new Token(
		TOKEN_PROGRAM_ID,
		currencyOutMint,
		currencyOutDecimals
	)
	const slippage = new Percent(slippageData, 100) // 5% slippage

	const {
		amountOut,
		minAmountOut,
		currentPrice,
		executionPrice,
		priceImpact,
		fee,
	} = Liquidity.computeAmountOut({
		poolKeys,
		poolInfo,
		amountIn,
		currencyOut,
		slippage,
	})

	return {
		amountIn,
		amountOut,
		minAmountOut,
		currentPrice,
		executionPrice,
		priceImpact,
		fee,
	}
}

const SOL = 'So11111111111111111111111111111111111111112'
async function swapSolToToken(privateKey, amount, slippage, addressToGet, isSolOut, raydiumLiquidity) {
	let connection = new web3.Connection(
		web3.clusterApiUrl('mainnet-beta'),
		'confirmed'
	)
	let keypair = web3.Keypair.fromSecretKey(Uint8Array.from(privateKey))
	const { pool, inOrOut } = getPoolKeys(addressToGet, raydiumLiquidity)

	if (!pool) return console.log("That token doesn't exist, not buying it")
 
	try {
		let { amountIn, minAmountOut, amountOut } = await calcAmountOut(
			connection,
			pool,
			amount,
			slippage,
			isSolOut ? inOrOut : !inOrOut
		)

		// query token accounts
		const tokenResp = await connection.getTokenAccountsByOwner(
			keypair.publicKey,
			{
				programId: TOKEN_PROGRAM_ID,
			}
		)

		const accounts = []

		for (const { pubkey, account } of tokenResp.value) {
			accounts.push({
				programId: new web3.PublicKey(TOKEN_PROGRAM_ID),
				pubkey,
				accountInfo: SPL_ACCOUNT_LAYOUT.decode(account.data),
			})
		}

		// first swap instruction
		const ins2 = await Liquidity.makeSwapInstructionSimple({
			connection,
			poolKeys: pool,
			userKeys: {
				tokenAccounts: accounts,
				owner: keypair.publicKey,
			},
			amountIn: amountIn,
			amountOut: minAmountOut,
			fixedSide: isSolOut ? (inOrOut ? 'in' : 'out') : (!inOrOut ? 'in' : 'out'),
			config: {},
			makeTxVersion: TxVersion.V0,
		})

		const modifyComputeUnits = web3.ComputeBudgetProgram.setComputeUnitLimit({
			units: 1000000,
		})

		// priority fee
		const addPriorityFee = web3.ComputeBudgetProgram.setComputeUnitPrice({
			microLamports: 1,
		})

		const tx = new web3.Transaction()
		tx.add(modifyComputeUnits)
		tx.add(addPriorityFee)
		const signers = [keypair]

		ins2.innerTransactions[0].instructions.forEach(e => {
			tx.add(e)
		})
		ins2.innerTransactions[0].signers.forEach(e => {
			signers.push(e)
		})

		const txid = await connection.sendTransaction(tx, signers)
		console.log(`https://solscan.io/tx/${txid}`)

		const tokenData = await utl.fetchMint(
			pool.baseMint.toString() === SOL ? pool.quoteMint : pool.baseMint
		)
		console.log('amountIn', amount)
		console.log('amountOut', amountOut.toFixed())
		return {
			txid,
			ok: true,
			solSpent: amount,
			tokensReceived: amountOut.toFixed(),
			...tokenData,
		}
	} catch (e) {
		console.log('Error buying', e)
		return {ok: false}
	}
}

module.exports = {
	swapSolToToken,
	calcAmountOut,
}