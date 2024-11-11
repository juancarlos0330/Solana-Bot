const { Connection, PublicKey } = require('@solana/web3.js')

async function getSwaps(accountAddress) {
	const connection = new Connection('https://api.mainnet-beta.solana.com')
	const accountInfo = await connection.getSignaturesForAddress(accountAddress)
	if (!accountInfo) {
		console.error('Account not found')
		return []
	}

    console.log('accountInfo', accountInfo)

    const signatures = accountInfo.map(item => item.signature)

    const res = await connection.getParsedTransactions(signatures, {maxSupportedTransactionVersion: 0})
    console.dir(res.map(tx => tx.transaction.message), {depth: null})
}

getSwaps(new PublicKey('9qCmSXeo6re9zboQfVKfgYExJ9YsmXWADQPFWyoXnKAz'))

/*

1. Given a transaction that was made by a user, check if that token is already sold or not

2. To see if it's sold, check the previous transactions and find the most recent one where the token was traded

3. Check the amount that was received and the amount sold. Update the database with the tradeSells data

*/
