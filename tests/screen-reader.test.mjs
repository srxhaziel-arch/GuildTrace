import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDetection, extractGuildName, guildKey } from '../src/lib/screen-reader.ts';

test('extracts a labelled guild without changing its spelling', () => {
  for (const label of ['Gremio:', 'Guild:', 'Guild name:', 'Propietario:', 'Owner:', 'Owned by:', 'Pertenece a:']) {
    assert.equal(extractGuildName(`Escondite\n${label} PlVAS\nNivel: 3`), 'PlVAS');
  }
  assert.equal(extractGuildName('Gremio:\ntake care\nNivel: 3'), 'take care');
  assert.notEqual(guildKey('PIVAS'), guildKey('PlVAS'));
});

test('rejects ambiguous frames and unrelated game text', () => {
  for (const text of ['Gremios detectados', 'Alliance: ABC', 'Escondite\nNivel: 3', 'Guild:\nLevel: 3', 'Gremio: ifures\nOwner: darkmight']) {
    assert.equal(extractGuildName(text), null, text);
  }
  assert.equal(extractGuildName('1234', true), null);
});

test('reads an unlabelled name only in the explicitly selected-name mode', () => {
  assert.equal(extractGuildName('take care'), null);
  assert.equal(extractGuildName('take care', true), 'take care');
  assert.equal(extractGuildName('take care\nNivel: 3', true), null);
});

test('deduplicates repeated detections while preserving first-seen order and review state', () => {
  let list = [];
  for (const name of ['ifures', 'pivas', 'take care', 'darkmight', ' PIVAS ', 'take   care']) list = addDetection(list, name);
  assert.deepEqual(list.map((guild) => guild.name), ['ifures', 'pivas', 'take care', 'darkmight']);
  assert.ok(list.every((guild) => !guild.reviewed));
  list[0].reviewed = true;
  assert.equal(addDetection(list, 'IFURES'), list);
  assert.equal(list[0].reviewed, true);
});
