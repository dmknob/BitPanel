'use strict';
const { calculateBitcoinSupply } = require('../helpers/calculations');

describe('calculateBitcoinSupply', () => {
    test('bloco genesis (altura 0) retorna 50 BTC', () => {
        expect(calculateBitcoinSupply(0)).toBe(50);
    });

    test('altura 1 retorna 100 BTC', () => {
        expect(calculateBitcoinSupply(1)).toBe(100);
    });

    test('último bloco antes do 1º halving (209999) = 210000 * 50 BTC', () => {
        expect(calculateBitcoinSupply(209999)).toBeCloseTo(210_000 * 50, 5);
    });

    test('primeiro bloco após 1º halving (210000) = 10.500.000 + 25 BTC', () => {
        expect(calculateBitcoinSupply(210000)).toBeCloseTo(10_500_000 + 25, 5);
    });

    test('após 2º halving (420000) = correto para época 2', () => {
        // Época 0: 210000 * 50 = 10.500.000
        // Época 1: 210000 * 25 = 5.250.000
        // Bloco 420000 (1º da época 2): +12.5 BTC
        const expected = 10_500_000 + 5_250_000 + 12.5;
        expect(calculateBitcoinSupply(420000)).toBeCloseTo(expected, 5);
    });

    test('não ultrapassa 21 milhões de BTC', () => {
        expect(calculateBitcoinSupply(10_000_000)).toBeLessThanOrEqual(21_000_000);
    });

    test('retorna valor positivo para blockHeight grande', () => {
        expect(calculateBitcoinSupply(896000)).toBeGreaterThan(19_000_000);
    });
});
