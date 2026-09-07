import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireSchedule } from '../public/pacing.js';

test('2400 bps sends 240 legacy characters in one second before stalls', () => {
  const frames = wireSchedule('x'.repeat(240), { stalls: false });
  assert.ok(Math.abs(frames.at(-1).at - 1000) < 0.001);
});
test('CRLF and nonprinting color bytes consume transmission time', () => {
  const frames = wireSchedule('A\n', { stalls: false, overhead: 9 });
  assert.ok(Math.abs(frames.at(-1).at - 50) < 0.001);
});
test('small lag spikes accumulate across short output lines', () => {
  const state = {}; let elapsed = 0;
  for (let i = 0; i < 6; i++) elapsed += wireSchedule('x'.repeat(100), { random: () => 0, state }).at(-1).at;
  assert.ok(Math.abs(elapsed - (2500 + 30)) < 0.001);
  assert.equal(state.wireBytes, 600);
});
