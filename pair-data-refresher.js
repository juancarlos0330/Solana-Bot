const fsPromises = require('fs/promises')
const fs = require('fs')
const path = require('path')

const updateMainnetData = async () => {
    console.log('Updating raydium pairs data...')
    const req = await fetch('https://api.raydium.io/v2/sdk/liquidity/mainnet.json')
    if (!req.ok) return console.log('rate limited') // We're being rate-limited
    const res = await req.json()
    const data = JSON.stringify(res)
    await fsPromises.writeFile(path.join(__dirname, 'mainnet-temp.json'), data, {flag: 'w'}, (err) => {
        if (err) console.log('err', err)
    })
    console.log('Overriding mainnet.json')
    // Move the file to the proper one
    await fsPromises.rename(path.join(__dirname, 'mainnet-temp.json'), path.join(__dirname, 'mainnet.json'))
    console.log('Overriding mainnet.json done')
    console.log('Done updating')
}

const updateJupyterTokenData = async () => {
    console.log('Updating raydium pairs data...')
    const req = await fetch('https://token.jup.ag/all')
    if (!req.ok) return console.log('rate limited') // We're being rate-limited
    const res = await req.json()
    const data = JSON.stringify(res)
    await fsPromises.writeFile(path.join(__dirname, 'tokens-data-temp.json'), data, {flag: 'w'}, (err) => {
        if (err) console.log('err', err)
    })
    console.log('Overriding tokens-data.json')
    // Move the file to the proper one
    await fsPromises.rename(path.join(__dirname, 'tokens-data-temp.json'), path.join(__dirname, 'tokens-data.json'))
    console.log('Overriding mainnet.json done')
    console.log('Done updating')
}

const watcherRaydiumPairLiquidity = async () => {
    // We don't get the pairs because it's creating a 429 too many requests
    try {
        await fsPromises.readFile(path.join(__dirname, 'mainnet.json'), 'utf-8')
    } catch (e) {
        console.log('failed to read the file', e)
        updateMainnetData() // Updating the mainnet data
        updateJupyterTokenData()
    }
    setInterval(async () => {
        updateMainnetData()
        updateJupyterTokenData()
    }, 60e3) // Every minute
}

watcherRaydiumPairLiquidity()