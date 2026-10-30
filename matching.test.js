import test from 'node:test';
import assert from 'node:assert/strict';
import { bestMatchingSong, normalizedTitle } from './matching.js';

test('titres remasterisés identifiés comme équivalents', () => {
  assert.equal(normalizedTitle('Paranoid Android - Remastered'), normalizedTitle('Paranoid Android'));
  assert.equal(normalizedTitle('Paranoid Android (2017 Remaster)'), normalizedTitle('Paranoid Android'));
});

test('une version live ne peut pas devenir la version studio', () => {
  assert.notEqual(normalizedTitle('Reckoner - Live'), normalizedTitle('Reckoner'));
  assert.notEqual(normalizedTitle('Reckoner (Live, 2017 Remastered)'), normalizedTitle('Reckoner'));
});

test('artiste et titre requis pour identifier une tonalité', () => {
  const results = [
    { id: 'bad', title: 'Reckoner', artist: { name: 'Groupe différent' }, key_of: 'C' },
    { id: 'good', title: 'Reckoner', artist: { name: 'Radiohead' }, key_of: 'Em' }
  ];
  assert.equal(bestMatchingSong(results, 'Reckoner', 'Radiohead')?.id, 'good');
  assert.equal(bestMatchingSong(results, 'Reckoner - Live', 'Radiohead'), null);
});

test('artistes sous forme de tableaux acceptés', () => {
  const songs = [{ id: 'x', title: 'Song', artist: [{ name: 'One' }, { name: 'Two' }] }];
  assert.equal(bestMatchingSong(songs, 'Song', 'Two')?.id, 'x');
});
