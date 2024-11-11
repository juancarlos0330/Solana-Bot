const bs58 = require('bs58')
const {
	Connection,
	Keypair,
	PublicKey,
	Transaction,
	TransactionMessage,
	ComputeBudgetProgram,
	VersionedTransaction,
} = require('@solana/web3.js')
const {
	jsonInfo2PoolKeys,
	Liquidity,
	TokenAmount,
	Token,
	Percent,
	TOKEN_PROGRAM_ID,
} = require('@raydium-io/raydium-sdk')
const { LAMPORTS_PER_SOL } = require('@solana/web3.js')
const raydiumLiquidity = require('./mainnet.json')
const swapSolToToken = require('./swapSolToToken')

const connection = new Connection('https://api.mainnet-beta.solana.com')
const byteArray = bs58.decode('3H8GZhY8qQ8SaLLLdwzpGybewsMPznecWFLvNuoh5ksWRQEddPqiQqynfATSFry9FcdjCAUk432QybXqHFFr1gnE')
const wallet = Keypair.fromSecretKey(byteArray)

const RAY_SOL_LP_V4_POOL_KEY = '89ZKE4aoyfLBe2RuV6jM3JGNhaV18Nxh8eNtjRcndBip'
const SOL = new PublicKey('So11111111111111111111111111111111111111112')
const RAY = new PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R')

async function calcAmountOut(
	connection,
	poolKeys,
	rawAmountIn,
	swapInDirection
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
		poolKeys.programId,
		currencyInMint,
		currencyInDecimals
	)
	const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
	const currencyOut = new Token(
		poolKeys.programId,
		currencyOutMint,
		currencyOutDecimals
	)
	const slippage = new Percent(5, 100) // 5% slippage

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

const start = async () => {
	const publicKey = wallet.publicKey
	const balance = await connection.getBalance(publicKey)
	console.log('Sol Balance', balance / LAMPORTS_PER_SOL)

	const inputNumber = '1000000000000000'
	const ownerAddress = wallet.publicKey.toBase58()
	const tokenAccs = await connection.getParsedTokenAccountsByOwner(
		new PublicKey(ownerAddress),
		{ programId: TOKEN_PROGRAM_ID }
	)

	const getTokenAccountsUserNonZero = () => {
		return tokenAccs.value.filter(item => {
			return item.account.data.parsed.info.tokenAmount.uiAmount == 0
		})
	}
	const getPoolKeys = () => {
		const allPoolKeysJson = [
			...(raydiumLiquidity.official ?? []),
			...(raydiumLiquidity.unOfficial ?? []),
		]
		const poolKeysRaySolJson = allPoolKeysJson.find(
			item => item.lpMint === RAY_SOL_LP_V4_POOL_KEY
		)
		const raySolPk = jsonInfo2PoolKeys(poolKeysRaySolJson)
		return raySolPk
	}

	const tokenAccountsNonZero = getTokenAccountsUserNonZero()
	const pool = getPoolKeys()

	console.log('pool', pool.baseMint.toString())
	process.exit(0)

	const latestBlockhash = await connection.getLatestBlockhash({
		commitment: 'processed',
	})

	const { innerTransaction, address } = Liquidity.makeSwapFixedOutInstruction(
		{
			poolKeys: pool,
			userKeys: {
				tokenAccountIn: SOL,
				tokenAccountOut: RAY,
				owner: publicKey,
			},
			amountIn: inputNumber,
			minAmountOut: 0,
		},
		pool.version,
	)

	console.log('innerTransaction', innerTransaction)

	// const messageV0 = new TransactionMessage({
	// 	payerKey: wallet.publicKey,
	// 	recentBlockhash: latestBlockhash.blockhash,
	// 	instructions: [
	// 		ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
	// 		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }),
	// 		...innerTransaction.instructions,
	// 	],
	// }).compileToV0Message()

	// const transaction = new VersionedTransaction(messageV0)
	// transaction.sign([wallet, ...innerTransaction.signers])
	// const rawTransaction = transaction.serialize()

	const transaction = new Transaction().add(innerTransaction)
	
	// console.log('innerTransaction.signers', innerTransaction)
	process.exit(0)

	transaction.sign([wallet, ...innerTransaction.signers])
	const rawTransaction = transaction.serialize()
	const signature = await connection.sendRawTransaction(rawTransaction, {
		skipPreflight: true,
	})

	console.log(`https://solscan.io/tx/${signature}`)
}

// Last parameter is true when you want sol -> token and false when token -> sol
swapSolToToken(byteArray, 0.0001, 'EvH3F7bjXZen9k7EGXSXTJVbJ5FC9H3kPhAjcenWd4pn', true, raydiumLiquidity) // change amount here

// start()
