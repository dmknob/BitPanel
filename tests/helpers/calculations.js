'use strict';

function calculateBitcoinSupply(blockHeight) {
    let supply = 0;
    let reward = 50;
    const halvingInterval = 210_000;
    let blocksRemaining = blockHeight + 1;
    while (blocksRemaining > 0 && reward >= 1e-9) {
        const blocksInEpoch = Math.min(blocksRemaining, halvingInterval);
        supply += blocksInEpoch * reward;
        reward /= 2;
        blocksRemaining -= blocksInEpoch;
    }
    return supply;
}

function calculateStockToFlow(supply, blockHeight) {
    const halvingInterval = 210_000;
    const epoch = Math.floor(blockHeight / halvingInterval);
    const blockReward = 50 / Math.pow(2, epoch);
    const annualFlow = blockReward * 52_560;
    if (annualFlow <= 0) return null;
    return supply / annualFlow;
}

module.exports = { calculateBitcoinSupply, calculateStockToFlow };
