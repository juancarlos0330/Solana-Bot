const bs58 = require('bs58')
const solanaWeb3 = require('@solana/web3.js')

const start = async () => {
    const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'))
    const fromWallet = solanaWeb3.Keypair.fromSecretKey(
        bs58.decode(
            '3H8GZhY8qQ8SaLLLdwzpGybewsMPznecWFLvNuoh5ksWRQEddPqiQqynfATSFry9FcdjCAUk432QybXqHFFr1gnE'
        )
    )
    const toWallet = new solanaWeb3.PublicKey(
        'D4CfaARJrB4CS77JxA2WKYeKL7CrFN8KiLb2HPgWG22e'
    )
    let transaction = new solanaWeb3.Transaction().add(
        solanaWeb3.SystemProgram.transfer({
            fromPubkey: fromWallet.publicKey,
            toPubkey: toWallet,
            lamports: solanaWeb3.LAMPORTS_PER_SOL * 0.0001, // Set the amount you'd like to send, in SOL.
        })
    )
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
    transaction.sign(fromWallet)
    let signature = await connection.sendTransaction(transaction, fromWallet)
    await solanaWeb3.confirmTransaction(connection, signature)
}

start()