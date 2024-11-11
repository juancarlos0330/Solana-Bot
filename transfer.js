const {web3, wallet} = require("@solana/web3.js");

// Airdrop SOL for paying transactions
let payer = web3.Keypair.generate();
const wallet = new wallet(Keypair.fromSecretKey(bs58.decode(decoded)));
let connection = new web3.Connection(web3.clusterApiUrl("devnet"), "confirmed");

console.log(payer);
async function air() {
  let airdropSignature = await connection.requestAirdrop(
    payer.publicKey,
    web3.LAMPORTS_PER_SOL
  );
  console.log(airdropSignature);
}

air()
// await connection.confirmTransaction({ signature: airdropSignature });

// let toAccount = web3.Keypair.generate();

// // Create Simple Transaction
// let transaction = new web3.Transaction();

// const amount = 0.001;

// // Add an instruction to execute
// transaction.add(
//   web3.SystemProgram.transfer({
//     fromPubkey: payer.publicKey,
//     toPubkey: toAccount.publicKey,
//     lamports: amount * web3.LAMPORTS_PER_SOL,
//   }),
// );

// // Send and confirm transaction
// // Note: feePayer is by default the first signer, or payer, if the parameter is not set
// await web3.sendAndConfirmTransaction(connection, transaction, [payer]);
