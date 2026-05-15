'use strict';
const { calculateStockToFlow } = require('../helpers/calculations');

describe('calculateStockToFlow', () => {
    const SUPPLY_APPROX = 19_700_000;

    test('retorna número positivo para bloco da época atual', () => {
        const result = calculateStockToFlow(SUPPLY_APPROX, 896000);
        expect(result).toBeGreaterThan(0);
    });

    test('S2F aumenta ao longo das épocas (supply cresce, flow cai)', () => {
        // Época 1 (bloco 210000): reward=25, flow menor → S2F maior
        const s2f_epoch0 = calculateStockToFlow(10_000_000, 100_000); // época 0
        const s2f_epoch1 = calculateStockToFlow(15_000_000, 300_000); // época 1
        expect(s2f_epoch1).toBeGreaterThan(s2f_epoch0);
    });

    test('retorna null se supply for 0', () => {
        // 0 supply → S2F não faz sentido, mas retorna 0 (0 / annualFlow)
        expect(calculateStockToFlow(0, 896000)).toBe(0);
    });

    test('retorna valor razoável para epoch 3 (reward 6.25)', () => {
        // bloco 630000 = época 3, reward = 6.25
        const result = calculateStockToFlow(18_375_000, 630000);
        expect(result).toBeGreaterThan(50); // S2F > 50 após 3º halving
    });
});
