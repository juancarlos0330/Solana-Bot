require("./dotenv-flow");
const crypto = require("crypto");
const Database = require("better-sqlite3");
//const sqlite3 = require('sqlite3').verbose();
const db = new Database("sqlite-database.db");
const web3 = require("@solana/web3.js");
const { Connection, Keypair } = require("@solana/web3.js");
const fsPromises = require("fs/promises");
const bs58 = require("bs58");
const path = require("path");
const { Wallet } = require("@project-serum/anchor");
const { Client, UtlConfig } = require("@solflare-wallet/utl-sdk");
const { Metaplex, amount } = require("@metaplex-foundation/js");
const {
  jsonInfo2PoolKeys,
  Liquidity,
  TokenAmount,
  Token,
  Percent,
  TOKEN_PROGRAM_ID,
  SPL_ACCOUNT_LAYOUT,
  TxVersion,
} = require("@raydium-io/raydium-sdk");
const SOL = "So11111111111111111111111111111111111111112";

const setup = () => {
  return new Promise((resolve) => {
    // "paymentSystem" can be "stripe" or "coinbase-commerce"
    db.prepare(
      "CREATE TABLE IF NOT EXISTS telegramChannels (userId, username)"
    ).run();
    db.prepare("CREATE TABLE IF NOT EXISTS botActive (isActive)").run();
    db.prepare(
      "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, pubkey)"
    ).run();
    db.prepare(
      "CREATE TABLE IF NOT EXISTS wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, encodedPrivateKey, userId)"
    ).run();
    // This table only allows 1 item
    db.prepare(
      `CREATE TABLE IF NOT EXISTS settings (
            amountPerTrade,
            maxSlippagePercentage,
            isAutoTradingActivated,
            lockInProfits,
            stopLossPercentage,
            trailingStopLossPercentageFromHigh,
            percentageToTakeAtTrailingStopLoss,
            rpc,
            singleton INTEGER UNIQUE CHECK (singleton = 1)
        )`
    ).run();
    // `lockedInProfits` means the program sold half of the position because it made a profit of 2x or more meaning we have a risk free trade
    // Remember that booleans in sqlite are represented as 0 false or 1 true when requesting that data
    db.prepare(
      `CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
			walletId,
            txid,
            symbol,
            address,
            decimals,
            solSpent,
            tokensReceived,
            lockedInProfits BOOLEAN
        )`
    ).run();
    // The Id Associated Trade ☝🏻 where `address` is the token sold
    db.prepare(
      `CREATE TABLE IF NOT EXISTS tradesSells (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idAssociatedTrade,
            address,
            txid,
            tokensSold,
            solReceived
        )`
    ).run();
    // `highestProfitPercentage` is the highest point at the current trade
    db.prepare(
      `CREATE TABLE IF NOT EXISTS tradeMonitoring (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idAssociatedTrade,
            highestProfitPercentage,
            highestProfitValue
        )`
    ).run();
    console.log("Database ready");
    resolve();
  });
};

let showLocalLogs = false;
const calcAmountOut = async (
  connection,
  poolKeys,
  rawAmountIn,
  slippageData,
  swapInDirection
) => {
  const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
  let currencyInMint = poolKeys.baseMint;
  let currencyInDecimals = poolInfo.baseDecimals;
  let currencyOutMint = poolKeys.quoteMint;
  let currencyOutDecimals = poolInfo.quoteDecimals;

  if (showLocalLogs) console.log("1 / 4");

  if (!swapInDirection) {
    currencyInMint = poolKeys.quoteMint;
    currencyInDecimals = poolInfo.quoteDecimals;
    currencyOutMint = poolKeys.baseMint;
    currencyOutDecimals = poolInfo.baseDecimals;
  }
  if (showLocalLogs) console.log("2 / 4");

  const currencyIn = new Token(
    TOKEN_PROGRAM_ID,
    currencyInMint,
    currencyInDecimals
  );
  const amountIn = new TokenAmount(currencyIn, rawAmountIn.toFixed(8), false);
  const currencyOut = new Token(
    TOKEN_PROGRAM_ID,
    currencyOutMint,
    currencyOutDecimals
  );

  const slippage = new Percent(slippageData * 100, 10000); // Slippage can be up to 0.01%
  if (showLocalLogs) console.log("3 / 4");

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
  });
  if (showLocalLogs) console.log("4 / 4");

  return {
    amountIn,
    amountOut,
    minAmountOut,
    currentPrice,
    executionPrice,
    priceImpact,
    fee,
  };
};

const asyncTimeout = (time) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

const getRPC = () => {
  const rpcData = db.prepare("SELECT rpc FROM settings").get();
  const rpc =
    rpcData && rpcData.rpc
      ? rpcData.rpc
      : "https://api.mainnet-beta.solana.com/";
  //			: "https://rpc.ankr.com/solana/9dcc92934779a87ccda30c94b74f7195d5635242da0e3e94bfe79b3fc0de5b1f"
  return rpc;
};

const swapSolToToken = async (
  privateKey,
  amount,
  slippage,
  addressToGet,
  isSolOut,
  raydiumLiquidity
) => {
  const connection = new Connection(getRPC());
  let keypair = web3.Keypair.fromSecretKey(Uint8Array.from(privateKey));
  const { pool, inOrOut } = getPoolKeys(addressToGet, raydiumLiquidity);

  if (!pool) {
    console.log("That token doesn't exist, not buying it");
    return { ok: false };
  }

  console.log("1 / 5");

  try {
    let { amountIn, minAmountOut, amountOut } = await calcAmountOut(
      connection,
      pool,
      amount,
      slippage,
      isSolOut ? inOrOut : !inOrOut
    );

    // query token accounts
    const tokenResp = await connection.getTokenAccountsByOwner(
      keypair.publicKey,
      {
        programId: TOKEN_PROGRAM_ID,
      }
    );

    const accounts = [];

    console.log("2 / 5");
    for (const { pubkey, account } of tokenResp.value) {
      accounts.push({
        programId: new web3.PublicKey(TOKEN_PROGRAM_ID),
        pubkey,
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(account.data),
      });
    }

    console.log("3 / 5");
    console.log(
      "fixed side",
      isSolOut ? (inOrOut ? "in" : "out") : !inOrOut ? "in" : "out"
    );

    // first swap instruction
    const ins2 = await Liquidity.makeSwapInstructionSimple({
      connection,
      poolKeys: pool,
      userKeys: {
        tokenAccounts: accounts,
        owner: keypair.publicKey,
      },
      amountIn,
      // amountOut: amountOut,
      amountOut: minAmountOut,
      // fixedSide: isSolOut ? (inOrOut ? 'in' : 'out') : (!inOrOut ? 'in' : 'out'),
      fixedSide: "in", // This makes sure the input amount is always right
      config: {},
      makeTxVersion: TxVersion.V0,
    });

    const modifyComputeUnits = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1000000,
    });

    // priority fee
    const addPriorityFee = web3.ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1,
    });

    const tx = new web3.Transaction();
    tx.add(modifyComputeUnits);
    tx.add(addPriorityFee);
    const signers = [keypair];

    ins2.innerTransactions[0].instructions.forEach((e) => {
      tx.add(e);
    });
    ins2.innerTransactions[0].signers.forEach((e) => {
      signers.push(e);
    });
    console.log("4 / 5");
    console.log("Sending transaction...");
    const txid = await connection.sendTransaction(tx, signers, {
      maxRetries: 3,
    });
    console.log(`https://solscan.io/tx/${txid}`);

    await asyncTimeout(10e3); // Wait seconds for confirmation and check the balance
    // const tokenReceived = await getTokenBalance(keypair.publicKey, addressToGet)
    // if (!tokenReceived) return { ok: false }

    console.log("5 / 5");

    const rpcData = db.prepare("SELECT rpc FROM settings").get();
    const rpc =
      rpcData && rpcData.rpc
        ? rpcData.rpc
        : "https://api.mainnet-beta.solana.com/";
    const config = new UtlConfig({
      chainId: 101,
      timeout: 2000,
      connection: new web3.Connection(rpc),
      apiUrl: "https://token-list-api.solana.cloud",
      cdnUrl:
        "https://cdn.jsdelivr.net/gh/solflare-wallet/token-list/solana-tokenlist.json",
    });
    const utl = new Client(config);
    const tokenData = await utl.fetchMint(
      pool.baseMint.toString() === SOL ? pool.quoteMint : pool.baseMint
    );
    console.log("amount", amount);
    console.log("amountIn", amountIn.toFixed());
    console.log("amountOut", minAmountOut.toFixed());
    return {
      txid,
      ok: true,
      solSpent: amountIn.toFixed(),
      tokensReceived: minAmountOut.toFixed(),
      ...tokenData,
    };
  } catch (e) {
    console.log("Error buying", e);
    return { ok: false };
  }
};

const encryptMessage = (message, seed) => {
  const algorithm = "aes-256-cbc";
  const initVector = crypto.randomBytes(16);
  const hash = crypto.createHash("sha256");
  hash.update(seed);
  const Securitykey = hash.digest().slice(0, 32);
  const cipher = crypto.createCipheriv(algorithm, Securitykey, initVector);

  let encryptedData = cipher.update(message, "utf-8", "hex");
  encryptedData += cipher.final("hex");

  return initVector.toString("hex") + ":" + encryptedData;
};

const decryptMessage = (encryptedStr, seed) => {
  const algorithm = "aes-256-cbc";
  const [iv, encryptedData] = encryptedStr.split(":");
  const initVector = Buffer.from(iv, "hex");
  const hash = crypto.createHash("sha256");
  hash.update(seed);
  const Securitykey = hash.digest().slice(0, 32);
  const decipher = crypto.createDecipheriv(algorithm, Securitykey, initVector);

  let decryptedData = decipher.update(encryptedData, "hex", "utf-8");
  decryptedData += decipher.final("utf8");

  return decryptedData;
};

const getUserByPubkey = (pubkey) => {
  const result = db
    .prepare("SELECT id FROM users WHERE pubkey=@pubkey")
    .get({ pubkey });
  if (result) {
    return { ok: true, userId: result.id };
  }
  return { ok: false };
};

const encryptAndStorePrivateKey = (privateKey, pubkey) => {
  try {
    const encoded = encryptMessage(privateKey, process.env.ENCODING_SEED);
    const user = getUserByPubkey(pubkey);
    if (!user.ok) return { ok: false };
    db.prepare(
      "INSERT INTO wallets (encodedPrivateKey, userId) VALUES (@encodedPrivateKey, @userId)"
    ).run({
      encodedPrivateKey: encoded,
      userId: user.userId,
    });
    return {
      ok: true,
    };
  } catch (e) {
    return { ok: false, error: e };
  }
};

const decryptPrivateKey = (pubkey) => {
  try {
    const user = getUserByPubkey(pubkey);
    const result = db
      .prepare(
        "SELECT id, encodedPrivateKey FROM wallets WHERE userId=@userId ORDER BY id DESC LIMIT 1"
      )
      .get({ userId: user.userId });
    const decoded = decryptMessage(
      result.encodedPrivateKey,
      process.env.ENCODING_SEED
    );
    return {
      ok: true,
      decoded,
      id: result.id,
    };
  } catch (e) {
    return { ok: false, error: e };
  }
};

const getPoolKeys = (addressToFind, raydiumLiquidity) => {
  console.log("getPoolKeys");

  const allPoolKeysJson = [
    ...(raydiumLiquidity.official ?? []),
    ...(raydiumLiquidity.unOfficial ?? []),
  ];
  let inOrOut = false;
  addressToFind = addressToFind.toLowerCase();
  const poolKeysRaySolJson = allPoolKeysJson.filter((item) => {
    if (item.baseMint.toLowerCase() === addressToFind) inOrOut = false;
    if (item.quoteMint.toLowerCase() === addressToFind) inOrOut = true;
    if (item.id.toLowerCase() === addressToFind) {
      // If we look for the pair address
      if (item.baseMint.toLowerCase() != SOL) inOrOut = false;
      else inOrOut = true;
    }
    return (
      (item.baseMint.toLowerCase() === addressToFind ||
        item.quoteMint.toLowerCase() === addressToFind ||
        item.id.toLowerCase() === addressToFind) &&
      (item.baseMint.toLowerCase() === SOL.toLowerCase() ||
        item.quoteMint.toLowerCase() === SOL.toLowerCase())
    );
  });
  const pool = poolKeysRaySolJson
    ? jsonInfo2PoolKeys(poolKeysRaySolJson)[0]
    : null;

  return { pool, inOrOut };
};

// Returns all the tokens you have including token, uiAmount, amount, decimals
const getAllTokensBalance = async (ownerPublicKey) => {
  const connection = new Connection(getRPC());
  const tokenAccs = await connection.getParsedTokenAccountsByOwner(
    ownerPublicKey,
    { programId: TOKEN_PROGRAM_ID }
  );
  const tokensNonZeroBalance = tokenAccs.value
    .filter((item) => {
      return item.account.data.parsed.info.tokenAmount.uiAmount != 0;
    })
    .map((item) => {
      return {
        token: item.account.data.parsed.info.mint,
        uiAmount: item.account.data.parsed.info.tokenAmount.uiAmount,
        amount: item.account.data.parsed.info.tokenAmount.amount,
        decimals: item.account.data.parsed.info.tokenAmount.decimals,
      };
    });
  return tokensNonZeroBalance;
};

// Returns null if that token found
const getTokenBalance = async (ownerPublicKey, tokenToTarget) => {
  const tokensNonZeroBalance = await getAllTokensBalance(ownerPublicKey);
  let selectedTokenBalance = tokensNonZeroBalance.find((item) => {
    return item.token.toLowerCase() == tokenToTarget.toLowerCase();
  });
  if (!selectedTokenBalance) return null;
  return selectedTokenBalance;
};

// Returns all the positions formatted with profits and unrealizedProfits which are calculated from the remaining balance the user has
const getTrades = async (pubkey) => {
  const privateKey = decryptPrivateKey(pubkey);
  if (!privateKey || !privateKey.ok) return { ok: false, msg: "No trades" };
  const trades = db
    .prepare("SELECT * FROM trades WHERE walletId=@walletId")
    .all({ walletId: privateKey.id });
  const tradesSells = db.prepare("SELECT * FROM tradesSells").all();
  const settings = db.prepare("SELECT * FROM settings").get();
  const byteArray = bs58.decode(privateKey.decoded);
  const wallet = Keypair.fromSecretKey(byteArray);
  const balances = await getAllTokensBalance(wallet.publicKey);

  /// Calculate the unrealized and realized profit
  for (let i = 0; i < trades.length; i++) {
    const sellFoundDatas = tradesSells.filter(
      (item) => item.idAssociatedTrade == trades[i].id
    );
    trades[i] = {
      ...trades[i],
      solReceived: 0,
      profit: 0,
      profitPercentage: 0,
      unrealizedProfit: 0,
      unrealizedProfitPercentage: 0,
      lostTrackOfToken: false, // Meaning the user sold the tokens elsewhere or transfered them to another wallet
    };
    // Calculate the realized profit
    if (sellFoundDatas && sellFoundDatas.length > 0) {
      const totalSolReceived = sellFoundDatas.reduce((total, sellFoundData) => {
        return Number(total) + Number(sellFoundData.solReceived);
      }, 0);

      const p = totalSolReceived - trades[i].solSpent; // Calculates all the SOL received from multiple sales and calculates the realized profit

      trades[i] = {
        ...trades[i],
        solReceived: totalSolReceived / 1e9,
        profit: p / 1e9,
        profitPercentage: (p * 100) / trades[i].solSpent,
      };
    }

    // If there's a 100% sale on this trade, set it as sold and skip the  unrealized profits calculation
    const totalTokensSold = sellFoundDatas.reduce((total, sellFoundData) => {
      return Number(total) + Number(sellFoundData.tokensSold);
    }, 0);
    if (totalTokensSold == trades[i].tokensReceived) continue;

    const lastIndexForThisItem = trades
      .map((item) => item.address)
      .lastIndexOf(trades[i].address);
    if (lastIndexForThisItem != i) continue; // Skip unrealized profit calculation for previous tokens if they are the same

    // Calculate the unrealized profit
    const tokenFoundData = balances.find(
      (balanceItem) =>
        balanceItem.token &&
        trades[i].address &&
        balanceItem.token.toLowerCase() == trades[i].address.toLowerCase()
    );
    if (!tokenFoundData) {
      // User doesn't have those tokens in his active balance anymore
      trades[i].lostTrackOfToken = true;
    } else {
      try {
        let quote = await getAmountOutJupyter(
          tokenFoundData.token,
          SOL,
          //					tokenFoundData.amount,
          trades[i].tokensReceived,
          settings.maxSlippagePercentage
        );
        if (!quote || quote.error) continue;
        let amountOut = quote.outAmount; // SOL
        const unrealized = amountOut - trades[i].solSpent;

        trades[i].unrealizedProfit = unrealized / 1e9; // sol decimals
        trades[i].unrealizedProfitPercentage =
          (unrealized * 100) / trades[i].solSpent; // Profit goes from 0% to infinite
      } catch (e) {
        console.log("Error 5: getting trades", e);
        return { ok: false, msg: "Error 5: getting trades" };
      }
    }
  }

  return { ok: true, trades };
};

let activeIntervals = {};
let intervalPiece = 0; // Increases after each interval
/// `percentageToSell` goes from 1 to 100 where 50% would be half of the position and 100 the entire position
/// `lockProfits` means we're selling half the position after making an unrealized profit of 2x
const sellToken = async (id, percentageToSell, lockProfits, pubkey) => {
  console.log("> Selling token called <");
  const userId = getUserByPubkey(pubkey);
  const privateKey = decryptPrivateKey(pubkey);
  if (!privateKey || !privateKey.ok) return;
  const byteArray = bs58.decode(privateKey.decoded);
  const wallet = Keypair.fromSecretKey(byteArray);
  const settings = db.prepare("SELECT * FROM settings").get();
  const tradeData = db.prepare("SELECT * FROM trades WHERE id=@id").get({ id });

  if (!tradeData) {
    console.log("Trade not found");
    return { ok: false, msg: "Trade id not found" };
  }
  console.log(
    "Selling token",
    tradeData.address,
    "id",
    id,
    "percentageToSell",
    percentageToSell,
    "lockProfits",
    lockProfits
  );
  try {
    const tokenBalance = await getTokenBalance(
      wallet.publicKey,
      tradeData.address
    );
    if (!tokenBalance) return { ok: false, msg: "Token balance not found" };
    const amountToSell = (tokenBalance.amount * percentageToSell) / 100;
    const response = await swapJupyter(
      privateKey.decoded,
      tradeData.address,
      SOL,
      amountToSell,
      settings.maxSlippagePercentage
    );

    if (!response || !response.ok || !response.txid) {
      console.log("Coundn't get a quote, stopping");
      return { ok: false };
    }

    const storeDb = (receivedData) => {
      console.log("selling token");
      console.log("selling token");
      console.log("selling token");
      console.log("selling token");
      console.log("selling token");
      console.log("selling token");
      console.log("storing data");

      db.prepare(
        `INSERT INTO tradesSells (idAssociatedTrade, txid, address, tokensSold, solReceived)
				VALUES (@idAssociatedTrade, @txid, @address, @tokensSold, @solReceived)`
      ).run({
        idAssociatedTrade: id,
        txid: receivedData.txid,
        address: tradeData.address,
        tokensSold: receivedData.solSpent, // Tokens sold
        solReceived: receivedData.tokensReceived, // This is the sol received
      });

      // Only set to true once
      if (lockProfits) {
        db.prepare(
          `UPDATE trades SET lockedInProfits = @lockedInProfits WHERE walletId=@walletId`
        )
          .get({ walletId: privateKey.id })
          .run({
            lockedInProfits: true,
          });
        db.prepare(
          `INSERT INTO tradeMonitoring (idAssociatedTrade, highestProfitPercentage, highestProfitValue)
                    VALUES (@idAssociatedTrade, @highestProfitPercentage, @highestProfitValue)`
        ).run({
          idAssociatedTrade: id,
          highestProfitPercentage: 100,
          highestProfitValue: receivedData.tokensReceived, // Half of the solana you spent
        });
      }
    };

    // Check if tokens are empty, and try to sell again if they haven't been sold
    // let tokenBalanceAfterSelling = await getTokenBalance(
    // 	wallet.publicKey,
    // 	tradeData.address,
    // )
    // console.log("tokenBalanceAfterSelling", tokenBalanceAfterSelling)
    // if (!tokenBalanceAfterSelling || tokenBalanceAfterSelling.amount < tokenBalance.amount) {
    // 	console.log("sold at one")
    // 	storeDb(response)
    // 	return { ok: true, response }
    // }

    let intervalCounter = 0;
    intervalPiece++;
    const myInterCount = intervalPiece;
    const intervalSell = setInterval(async () => {
      console.log(
        "Selling interval check",
        intervalCounter,
        "out of",
        10,
        "tries"
      );
      intervalCounter++;
      tokenBalanceAfterSelling = await getTokenBalance(
        wallet.publicKey,
        tradeData.address
      );
      console.log("tokenBalanceAfterSellingasdf", tokenBalanceAfterSelling);
      console.log("tokenBalanceasdf", tokenBalance);
      // Token has been sold
      if (
        !tokenBalanceAfterSelling ||
        tokenBalanceAfterSelling.amount < tokenBalance.amount
      ) {
        console.log("Tokens sold, storing in the db");
        clearInterval(activeIntervals[myInterCount]);

        try {
          storeDb(response);
          return { ok: true, response };
        } catch (e) {
          console.log("Error saving trade", e);
          return { ok: false };
        }
      } else if (intervalCounter >= 10) {
        console.log("Enough tries, no sell detected. Stopping.");
        clearInterval(activeIntervals[myInterCount]);
        return { ok: false };
      }
    }, 3e3);
    // Mapping where the key is the address
    activeIntervals[myInterCount] = intervalSell;
  } catch (e) {
    console.log("Error selling token", e);
    return { ok: false, msg: "Error processing the trade send again" };
  }
  return { ok: true };
};

// Slippage is defined in bps which means 100 is 1% so we gotta multiply by 100
const getAmountOutJupyter = async (tokenA, tokenB, amount, slippage) => {
  // const url = `https://quote-api.jup.ag/v6/quote?inputMint=${tokenA}&outputMint=${tokenB}&amount=${Number(amount).toFixed(0)}&slippageBps=${slippage * 100}`
  const url = `https://jupiter-swap-api.quiknode.pro/543C9C08EE2B/quote?inputMint=${tokenA}&outputMint=${tokenB}&amount=${Number(
    amount
  ).toFixed(0)}&slippageBps=${slippage * 100}`;
  console.log(url);
  let quote = null;
  try {
    quote = await (await fetch(url)).json();
    if (!quote) {
      console.error("unable to quote");
      return null;
    }
  } catch (e) {
    console.log("Error getting quote", e);
    return null;
  }
  return quote;
};

const getTokenDataJupyter = async (token) => {
  try {
    const tokenData = JSON.parse(
      await fsPromises.readFile(
        path.join(__dirname, "tokens-data.json"),
        "utf-8"
      )
    );
    console.log("tokenData", tokenData);
    const found = tokenData.find(
      (data) => token.toLowerCase() == data.address.toLowerCase()
    );
    return found || null;
  } catch (e) {
    console.log("failed to read the file for the token data");
    return null;
  }
};

const getTokenData = async (tokenAddress) => {
  const connection = new Connection(getRPC());
  const metaplex = Metaplex.make(connection);
  const mintAddress = new web3.PublicKey(tokenAddress);
  const tokenData = await metaplex.nfts().findByMint({ mintAddress });
  // We only return what we need, there's more data there
  return {
    decimals: tokenData.mint.decimals,
    symbol: tokenData.json.symbol,
  };
};

const swapJupyter = async (privateKey, tokenA, tokenB, amount, slippage) => {
  console.log("starting swap...");
  console.log(
    "swapping:",
    amount,
    "of",
    tokenA,
    "for token:",
    tokenB,
    "with slippage:",
    slippage
  );

  let txid = null;
  let tokenData = null;
  let amountOut = null;
  let quote = null;

  const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));
  const connection = new Connection(getRPC());

  console.log("1");
  try {
    quote = await getAmountOutJupyter(tokenA, tokenB, amount, slippage);
    if (!quote || quote.error) {
      if (quote.error) console.log("quote response:", quote.error);
      return { ok: false };
    }
    amountOut = quote.outAmount;
    if (!amountOut) {
      console.log("quote", quote);
      return { ok: false };
    }
  } catch (e) {
    console.log("Error getting quote", e);
    return { ok: false };
  }
  console.log("2");
  try {
    // get serialized transaction
    const swapResult = await (
      await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toString(),
          dynamicComputeUnitLimit: true, // allow dynamic compute limit instead of max 1,400,000
          prioritizationFeeLamports: "auto", // or custom lamports: 1000
        }),
      })
    ).json();

    // submit transaction
    const swapTransactionBuf = Buffer.from(
      swapResult.swapTransaction,
      "base64"
    );
    let transaction = web3.VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet.payer]);
    const rawTransaction = transaction.serialize();
    txid = await connection.sendRawTransaction(rawTransaction, {
      maxRetries: 30,
      skipPreflight: false, // If you set this to true, you can skip the next one.
      preflightCommitment: "processed",
    });

    console.log(`https://solscan.io/tx/${txid}`);

    tokenData = await getTokenData(
      tokenA.toLowerCase() == SOL.toLowerCase() ? tokenB : tokenA
    );
    console.log(tokenData);
  } catch (e) {
    console.log("error: ", e.toString());
    console.log("Transaction didnt confirm in 60 seconds (it is still valid)");
    // The transaction may fail because it didn't confirm in 1 minute but 99% of the times it works a bit later
  }

  return {
    txid,
    ok: true,
    solSpent: amount,
    tokensReceived: amountOut,
    ...tokenData,
  };
};

module.exports = {
  setup,
  encryptMessage,
  decryptMessage,
  encryptAndStorePrivateKey,
  decryptPrivateKey,
  getPoolKeys,
  getAllTokensBalance,
  getTokenBalance,
  getTrades,
  sellToken,
  calcAmountOut,
  swapSolToToken,
  swapJupyter,
  getTokenDataJupyter,
  getTokenData,
  getRPC,
  getUserByPubkey,
};
