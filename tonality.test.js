import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey } from './tonality.js';
for (const [raw, expected] of [
  ['C#-Minor','C#m'],['B-Flat Major',null],['Bb-Major','Bb'],
  ['G-Major','G'],['A-Minor','Am'],['Unknown',null],['F#m','F#m'],
  ['Db-Major','Db'],[null,null],['','']
]) {
  test(`normalisation ${raw}`, () => assert.equal(normalizeKey(raw), expected === '' ? null : expected));
}
