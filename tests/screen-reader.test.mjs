import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDetection, extractGuildName, guildKey, matchKnownGuild } from '../src/lib/screen-reader.ts';
import { locateTooltip } from '../src/lib/tooltip-region.ts';

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

test('a name crop may contain an owner label or a wrapped label without being discarded', () => {
  assert.equal(extractGuildName('Gremio: take care', true), 'take care');
  assert.equal(extractGuildName('Owner:\nPlVAS', true), 'PlVAS');
  assert.equal(extractGuildName('Owner: ifures\nGuild: pivas', true), null);
});

test('matches a small HO heading against stored guilds without preserving its alliance prefix', () => {
  assert.equal(matchKnownGuild('[KAOS] K PA MI XAN', ['ifures', 'K PA MI XAN']), 'K PA MI XAN');
  assert.equal(matchKnownGuild('KAOS K PAMI XAN', ['K PA MI XAN']), 'K PA MI XAN');
  assert.equal(matchKnownGuild('Avalanche Incline\nNivel 1', ['K PA MI XAN']), null);
  assert.equal(matchKnownGuild('AAA K PA MI XAN', ['K PA MI XAN', 'MI XAN']), null);
  assert.equal(extractGuildName('[KAOS] K PA MI XAN', true), 'K PA MI XAN');
});

test('locates a compact dark tooltip on the map while excluding wide toolbars', () => {
  const width = 640, height = 360;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const fill = (x, y, w, h, rgb) => {
    for (let row = y; row < y+h; row++) for (let col = x; col < x+w; col++) pixels.set([...rgb,255], (row*width+col)*4);
  };
  fill(0,0,width,height,[170,160,195]);
  fill(50,30,540,18,[30,34,40]);
  assert.equal(locateTooltip(pixels,width,height),null);
  fill(280,140,110,48,[35,37,44]);
  for (let x=292;x<370;x+=6) fill(x,148,3,4,[225,220,210]);
  const region = locateTooltip(pixels,width,height);
  assert.ok(region);
  assert.ok(region.x*width <= 292 && (region.x+region.width)*width >= 370);
  assert.ok(region.y*height <= 148 && (region.y+region.height)*height >= 152);
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
