import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as bs58 from "bs58";
import io from "socket.io-client";

//import swal from 'sweetalert'
///import { Header, Payload, SIWS } from '@web3auth/sign-in-with-solana'

let wallet = null;
let autoTradingOn = false;
let solanaPrice = 100;
let mySocket = null;

let nonce = "";
let publicKey = "";
let message;

// Domain and origin
const domain = window.location.host;
const origin = window.location.origin;

window.addEventListener("load", async () => {
  //////////// Connect Wallet /////////////////////
  document.querySelector("#connect-wallet").addEventListener("click", () => {
    connectWallet();
  });
  /////////////////////////////////////////////////

  document.querySelector("#add-tg").addEventListener("click", async () => {
    const inputData = prompt("Telegram group to add (for example @bagcalls):");
    if (!inputData.startsWith("@")) {
      return alert("Must start with @");
    }
    if (inputData) {
      const req = await fetch(`/tg/${inputData}`);
      const res = await req.json();
      return getSetTgChannels();
    }
  });

  document.querySelector("#remove-tg").addEventListener("click", async () => {
    const inputData = prompt(
      "Telegram group to remove (for example @bagcalls):"
    );
    if (!inputData.startsWith("@")) {
      return alert("Must start with @");
    }
    if (inputData) {
      const req = await fetch(`/remove-tg/${inputData}`);
      const res = await req.json();
      if (!res.ok) return alert(res.error);
      return getSetTgChannels();
    }
  });

  //////// Start ////////
  document.querySelector("#tutorial").addEventListener("click", () => {
    // document.getElementById("cover-section").style.display = "block";
  });
  //////// End ////////

  document
    .querySelector("#create-wallet")
    .addEventListener("click", async () => {
      if (!publicKey) {
        alert("You should connect wallet first");
        return;
      }

      if (wallet) {
        const yes = confirm(
          "Your previous wallet will be deleted (you still have access if you stored the private key) and a new wallet will be created, continue?"
        );

        if (yes) newWalletCreation();
      } else {
        newWalletCreation();
      }
    });

  document
    .querySelector("#form-settings")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const req = await fetch("/settings", {
        method: "post",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          amountPerTrade:
            document.querySelector("#amountPerTrade").value / solanaPrice,
          maxSlippagePercentage: document.querySelector(
            "#maxSlippagePercentage"
          ).value,
          isAutoTradingActivated: Number(autoTradingOn),
          lockInProfits: Number(
            document.querySelector("#lockInProfits").checked
          ), // Boolean to number 0 false, 1 true
          stopLossPercentage: document.querySelector("#stopLossPercentage")
            .value,
          trailingStopLossPercentageFromHigh: document.querySelector(
            "#trailingStopLossPercentageFromHigh"
          ).value,
          percentageToTakeAtTrailingStopLoss: document.querySelector(
            "#percentageToTakeAtTrailingStopLoss"
          ).value,
          rpc: document.querySelector("#rpc-input").value,
        }),
      });
      const res = await req.json();
      if (res.ok) {
        alert("Settings saved successfully");
      } else {
        alert("Error saving settings try again");
      }
    });

  document.querySelector("#amountPerTrade").addEventListener("input", (e) => {
    const value =
      e.target.value.length == 0 ? "0" : e.target.value / solanaPrice;

    document.querySelector("#solana-amount-per-trade").innerHTML =
      value.toFixed(3);
  });

  document
    .querySelector(".start-button")
    .addEventListener("click", async () => {
      if (!publicKey) return alert("You should connect wallet first");
      const req = await fetch("/start");
      const res = await req.json();
      if (res.ok) {
        alert("Started");
      } else {
        alert("Couldn't start, try again");
      }
    });

  document.querySelector(".stop-button").addEventListener("click", async () => {
    if (!publicKey) return alert("You should connect wallet first");
    const req = await fetch("/stop");
    const res = await req.json();
    if (res.ok) {
      alert("Stopped");
    } else {
      alert("Couldn't stop, try again");
    }
  });

  document.querySelector("#save-rpc").addEventListener("click", async () => {
    const rpc = document.querySelector("#rpc-input").value;
    const req = await fetch("/set-rpc", {
      method: "post",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ rpc }),
    });
    const res = await req.json();
    if (res.ok) {
      alert("RPC saved");
    } else {
      alert("Error saving the RPC make sure it's correct");
    }
  });

  document.querySelector("#withdraw").addEventListener("click", async () => {
    if (!publicKey) return alert("You should connect wallet first");
    const amount = prompt(
      "Could you confirm the amount you wish to withdraw, please?"
    );
    if (!amount) return;
    const req = await fetch("/transfer", {
      method: "post",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ publicKey, amount }),
    });
    const res = await req.json();

    if (!res.ok) {
      return alert(res.error);
    }
    updateCreatedBalance();
  });

  // To visually update the auto trading button on turn it off and store the value
  Array.from(document.querySelectorAll(".auto-trading-button")).map(
    (button) => {
      button.addEventListener("click", (e) => {
        if (e.target == document.querySelector(".auto-trading-button")) {
          document.querySelectorAll(".auto-trading-button")[0].className =
            "auto-trading-button on-button";
          document.querySelectorAll(".auto-trading-button")[1].className =
            "auto-trading-button off-button";
        } else {
          document.querySelectorAll(".auto-trading-button")[0].className =
            "auto-trading-button off-button";
          document.querySelectorAll(".auto-trading-button")[1].className =
            "auto-trading-button on-button";
        }
        autoTradingOn = document
          .querySelector(".auto-trading-button")
          .className.includes("on-button");
      });
    }
  );

  start();
});

const hideSpinner = () => {
  document.getElementById("spinner").style.display = "none";
};

const showSpinner = () => {
  document.getElementById("spinner").style.display = "block";
};

const updateCreatedBalance = async () => {
  // Update balance of created wallet
  const req = await fetch(`/save-user/${publicKey}`);
  const res = await req.json();
  if (!res.ok) return;
  wallet = Keypair.fromSecretKey(bs58.decode(res.privateKey)); // Store globally
  showAddressAndBalance(wallet.publicKey.toString(), res.balance);
};

const getSetTgChannels = async () => {
  // Get
  const req = await fetch("/tgs");
  const res = await req.json();
  // Set
  document.querySelector("#active-telegram-channels").innerHTML = res.tgs
    .map((item, i) => {
      return `<p class="mx-3"><span class="span-grey">#${i + 1}</span>${
        item.username
      }</p>`;
    })
    .join("");
};

// Connect the solana wallet
const connectWallet = async () => {
  try {
    window.solana.connect().then(async (resp) => {
      publicKey = resp.publicKey.toString();
      removeAddressAndBalance();
      if (publicKey) {
        alert("Connected wallet successfully");
        const req = await fetch(`/save-user/${publicKey}`);
        const res = await req.json();
        console.log("Connecting Wallet Result", res);
        if (!res.ok) return alert(res.error);
        wallet = Keypair.fromSecretKey(bs58.decode(res.privateKey)); // Store globally
        showAddressAndBalance(wallet.publicKey.toString(), res.balance);
        getTrades();
      } else alert("Connecting wallet failed");
    });
  } catch (err) {
    console.log("User rejected the request." + err);
  }
};

const newWalletCreation = async () => {
  console.log("Creating wallet...");
  // Create a new random wallet
  wallet = Keypair.generate();
  const privateKey = bs58.encode(wallet.secretKey);
  prompt(
    "Copy and store the private key somewhere safe, you can add it to phantom wallet. It will only be shown once:",
    privateKey
  );
  const req = await fetch("/create-wallet", {
    method: "post",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ privateKey, publicKey }),
  });
  const res = await req.json();
  if (res.error) return alert(res.error);

  getWallet();
};

const removeAddressAndBalance = () => {
  document.querySelector("#wallet-address").innerHTML = "";
  document.getElementById("withdraw").style.display = "none";
};

const showAddressAndBalance = (wAddress, balance) => {
  document.querySelector(
    "#wallet-address"
  ).innerHTML = `Wallet: <span style="margin-left: 12px; margin-right: 12px;">${wAddress}</span> Balance: <span style="margin-left: 12px; margin-right: 12px;">${
    balance / LAMPORTS_PER_SOL
  }SOL</span>`;
  document.getElementById("withdraw").style.display = "block";
};

const getWallet = async () => {
  const req = await fetch("/get-wallet");
  if (!req.ok) return;
  const res = await req.json();
  if (res.ok) {
    wallet = Keypair.fromSecretKey(bs58.decode(res.privateKey)); // Store globally
    showAddressAndBalance(wallet.publicKey.toString(), res.balance);
  } else {
    console.log("Couldn't get the wallet");
  }
};

const intervalSolana = async () => {
  const req = await fetch("/solana-price");
  if (!req.ok) return;
  const res = await req.json();
  solanaPrice = res.solanaPrice;
  setInterval(async () => {
    if (!publicKey) return;
    const a = await fetch("/solana-price");
    const b = await a.json();
    solanaPrice = b.solanaPrice;

    getTrades(); // Get trades every 30s

    updateCreatedBalance();
  }, 5e3);
};

const getSettings = async () => {
  const req = await fetch("/get-settings");
  if (!req.ok) return;
  const res = await req.json();

  if (!res.ok) return;

  autoTradingOn = !!res.settings.isAutoTradingActivated; // Converts 0 or 1 to boolean where 0 is false
  if (autoTradingOn) {
    document.querySelectorAll(".auto-trading-button")[0].className =
      "auto-trading-button on-button";
    document.querySelectorAll(".auto-trading-button")[1].className =
      "auto-trading-button off-button";
  } else {
    document.querySelectorAll(".auto-trading-button")[0].className =
      "auto-trading-button off-button";
    document.querySelectorAll(".auto-trading-button")[1].className =
      "auto-trading-button on-button";
  }
  document.querySelector("#lockInProfits").checked = res.settings.lockInProfits;
  document.querySelector("#amountPerTrade").value = (
    res.settings.amountPerTrade * solanaPrice
  ).toFixed(3);
  document.querySelector("#solana-amount-per-trade").innerHTML =
    res.settings.amountPerTrade.toFixed(3);
  document.querySelector("#maxSlippagePercentage").value =
    res.settings.maxSlippagePercentage;
  document.querySelector("#trailingStopLossPercentageFromHigh").value =
    res.settings.trailingStopLossPercentageFromHigh;
  document.querySelector("#percentageToTakeAtTrailingStopLoss").value =
    res.settings.percentageToTakeAtTrailingStopLoss;
  document.querySelector("#stopLossPercentage").value =
    res.settings.stopLossPercentage;
  document.querySelector("#rpc-input").value = res.settings.rpc;
};

const setSocket = async () => {
  console.log("Starting socket");
  //    mySocket = io('https://solana.tasend.com')
  mySocket = io();
  console.log("Socket started");

  mySocket.on("connect", async () => {
    mySocket.on("new-log", (data) => {
      document.querySelector("#logger-screen").innerHTML = data;
      const container = document.getElementById("logger-screen");
      container.scrollTop = container.scrollHeight;
    });
  });
};

const formatString = (myString) => {
  if (myString.length <= 13) {
    return myString;
  }
  const firstFive = myString.slice(0, 5);
  const lastFive = myString.slice(-5);
  const asterisks = "***";
  return `${firstFive}${asterisks}${lastFive}`;
};

window.sellTrade = async (id) => {
  alert("Processing sell, please wait until the next message is shown");
  const req = await fetch(`/sell/${publicKey}/${id}`);
  const res = await req.json();

  if (res.ok) {
    prompt("Sold", `https://solscan.com/tx/${res.response.txid}`);
  } else {
    alert("Couldn't sell the token, try again");
  }
};

const getTrades = async () => {
  const req = await fetch(`/get-trades/${publicKey}`);
  if (!req.ok) return;
  const res = await req.json();
  if (!res || !res.trades) return;
  let html = `<div class="d-flex flex-row header-row">
            <div class="border-right">#</div>
            <div class="border-right">TOKEN TICKER</div>
            <div class="border-right">TOKEN ADDRESS</div>
            <div class="border-right">PURCHASE TX</div>
            <div class="border-right">CHART</div>
            <div class="border-right">UNREALIZED PROFIT</div>
            <div class="border-right">REALIZED PROFIT</div>
            <div class="border-right">PROFIT TAKEN <br/>& LOST TRACK</div>
            <div>SELL</div>
        </div>`;
  let tradesLength = res.trades.length;

  const itemsPerPage = 10;
  const totalPages = Math.ceil(res.trades.length / itemsPerPage);
  let currentPage = 1; // Assuming starting from page 1
  const updateTradeRows = () => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, res.trades.length);

    const formattedHTML = res.trades
      .slice(startIndex, endIndex)
      .reverse()
      .map((trade, i) => {
        let classProfit = "red";
        let classUnrealizedProfit = "red";
        if (trade.profit == 0) classProfit = "";
        else if (trade.profit > 0) classProfit = "green";
        if (trade.unrealizedProfit == 0) classUnrealizedProfit = "";
        else if (trade.unrealizedProfit > 0) classUnrealizedProfit = "green";
        return `
                <div class="d-flex flex-row body-row">
                    <div class="border-right border-down">#${
                      tradesLength - i
                    }</div>
                    <div class="border-right border-down">${trade.symbol}</div>
                    <div class="border-right border-down">
                        <button class="token-address-btn d-flex flex-row">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"
                                class="bi bi-copy" viewBox="0 0 16 16">
                                <path fill-rule="evenodd"
                                    d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h1v1z" />
                        </svg>
                        <a href="https://solscan.io/token/${
                          trade.address
                        }" target="_blank">${formatString(trade.address)}</a>
                    </button>
                </div>
                <div class="border-right border-down">
                    <a href="https://solscan.io/tx/${
                      trade.txid
                    }" target="_blank">${formatString(trade.txid)}</a>
                </div>
                <div class="border-right border-down">
                    <a href="https://birdeye.so/token/${
                      trade.address
                    }?chain=solana" target="_blank">Birdeye</a>
                </div>
                <div class="border-right border-down ${classUnrealizedProfit}">${trade.unrealizedProfit.toFixed(
          5
        )} <br/>(${trade.unrealizedProfitPercentage.toFixed(2)}%)</div>
                <div class="border-right border-down ${classProfit}">${
          classProfit == "green" ? "+" : ""
        }${
          String(trade.profit).length > 5
            ? trade.profit.toFixed(5)
            : trade.profit
        } SOL <br/>(${trade.profitPercentage.toFixed(2)}%)</div>
                <div class="border-right border-down">${
                  trade.lockedInProfits ? "Yes" : "No"
                } / ${trade.lostTrackOfToken ? "Yes" : "No"}</div>
                <div class="border-down"><button class="sell-button ${
                  trade.unrealizedProfit == 0 ? "disabled-sell" : ""
                }" onclick='sellTrade("${trade.id}")'>Sell</button></div>
            </div>
            `;
      });

    html += formattedHTML.join("\n");
    html += `<div class="d-flex flex-row footer-row">
                <p class="mx-2">Showing tokens ${
                  startIndex + 1
                }-${endIndex} of ${res.trades.length}</p>
                
                <button class="paginate-tokens mx-2">
                    Next page
                </button>
            </div>`;

    document.querySelector("#trade-rows").innerHTML = html;

    setTimeout(() => {
      document
        .querySelector(".paginate-tokens")
        .addEventListener("click", () => {
          currentPage = (currentPage % totalPages) + 1;
          updateTradeRows();
        });
    }, 0);
  };

  updateTradeRows();

  const rugCount = res.trades.reduce((sum, item) => {
    if (!item.lostTrackOfToken && Number(item.profitPercentage) <= -99)
      return sum + 1;
    return sum;
  }, 0);
  const totalPNL = res.trades
    .reduce((sum, item) => sum + Number(item.unrealizedProfit), 0)
    .toFixed(5);
  const totalProfit = res.trades
    .reduce((sum, item) => sum + Number(item.profit), 0)
    .toFixed(5);
  const totalSolInvested = res.trades
    .reduce((total, item) => total + Number(item.solSpent) / 1e9, 0)
    .toFixed(4);
  // Set the data for all the tokens
  document.querySelector("#total-tokens-invested").innerHTML =
    res.trades.length;
  document.querySelector("#total-rugs").innerHTML = rugCount;
  document.querySelector("#total-sol-invested").innerHTML =
    totalSolInvested + " SOL";
  document.querySelector("#total-pnl").innerHTML = totalPNL + " SOL";
  document.querySelector("#total-pnl").className = `border-right ${
    totalPNL >= 0 ? "green" : "red"
  }`;
  document.querySelector("#total-profits").innerHTML = totalProfit + " SOL";
  document.querySelector("#total-profits").className =
    totalProfit >= 0 ? "green" : "red";
};

const start = async () => {
  await intervalSolana(); // Get first price
  setSocket();
  getSettings();
  getSetTgChannels();
  //    getWallet()
  //    getTrades()
  autoTradingOn = document
    .querySelector(".auto-trading-button")
    .className.includes("on-button");
};
