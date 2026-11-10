import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { panels } from '../../app/panels';
import { openSource } from '../../app/session';
import { failure, journal, openModel, openWagon, pack, revision, schema, schemaError, selection } from '../../app/store';
import { audition } from '../../audio/audition';
import { MemorySource, readTree } from '../../core/pack/testing.node';
import { createSchema } from '../../core/schema';
import { readSchemaFiles } from '../../core/schema/files.node';
import { setLang } from '../../i18n';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { listenError } from './listen';
import { SoundsPanel } from './SoundsPanel';

const SHUNTER = 'assets/rwat_example/wagon_models/shunter.json';
const COACH = 'assets/rwat_example/wagon_models/coach.json';
const OGG = 'assets/rwat_example/sounds/horn.ogg';
const loaded = createSchema(readSchemaFiles());

function reset(): void {
  pack.value = null;
  journal.value = null;
  schema.value = null;
  schemaError.value = null;
  failure.value = null;
  selection.value = [];
  revision.value = 0;
  openWagon.value = null;
  openModel.value = null;
  listenError.value = null;
}

/** The example pack with a file of bytes the tab can offer (the page decodes it; here nothing does). */
function files(): Map<string, Uint8Array> {
  const tree = readTree(EXAMPLE_PACK);
  tree.set(OGG, new Uint8Array([79, 103, 103, 83]));
  return tree;
}

async function open(wagon: string | null = 'rwat_example:shunter'): Promise<HTMLElement> {
  await openSource(new MemorySource(files(), 'RwatExamplePack'));
  openWagon.value = wagon;
  return screen.getByTestId('sounds-root');
}

function json(file: string): { sounds: Record<string, unknown> } {
  return pack.value?.json(file) as { sounds: Record<string, unknown> };
}

beforeEach(() => {
  reset();
  setLang('en');
  schema.value = loaded;
  render(
    <div data-testid="sounds-root">
      <SoundsPanel />
    </div>,
  );
});

afterEach(() => {
  cleanup();
  reset();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the sounds tab is registered', () => {
  it('as a bottom tab after the names, for a pack of the RWAT format', () => {
    const sounds = panels.find((panel) => panel.id === 'sounds');
    expect(sounds).toMatchObject({ slot: 'bottom', order: 70, title: 'sounds.title', modes: ['2a'] });
    expect(Math.max(...panels.filter((panel) => panel.slot === 'bottom' && panel.id !== 'sounds').map((panel) => panel.order))).toBeLessThan(70);
  });
});

describe('the sounds tab', () => {
  it('asks for a pack, then for a wagon', async () => {
    expect(screen.getByText('No pack open.')).toBeTruthy();
    await open(null);
    expect(screen.getByText(/Pick a wagon in the pack tree/)).toBeTruthy();
  });

  it('shows the shunter’s sounds by role, with what the engine makes of each', async () => {
    const root = await open();
    await waitFor(() => expect(root.querySelector('[data-testid="sounds"]')).not.toBeNull());
    expect([...root.querySelectorAll('[data-sound]')].map((section) => [section.getAttribute('data-sound'), section.getAttribute('data-state')])).toEqual([
      ['idle', 'set'],
      ['wheels', 'set'],
      ['horn', 'set'],
      ['bell', 'set'],
      ['clack', 'set'],
      ['doors', 'unset'],
      ['controls', 'set'],
    ]);
    const idle = screen.getByTestId('sounds-section-idle');
    expect(within(idle).getByTestId('sounds-effective-idle').textContent).toBe('Pitch: 0.6 → 1.1 (at rest → at full)Volume: 0.5 → 1 (at rest → at full)');
    expect(idle.textContent).toContain('Carries 64 blocks.');
    const horn = screen.getByTestId('sounds-section-horn');
    expect(within(horn).getByTestId('sounds-effective-horn').textContent).toBe('A held signal sounds at pitch 0.8, volume 1.');
    expect(screen.getByTestId('sounds-section-horn').textContent).toContain('Carries 192 blocks.');
    expect(screen.getByTestId('sounds-section-bell').textContent).toContain('Carries 128 blocks.');
    const bell = within(screen.getByTestId('sounds-effective-bell').parentElement as HTMLElement);
    expect(bell.getByTestId('sounds-effective-bell').textContent).toBe('A held signal sounds at pitch the file as it is, volume the file as it is.');
  });

  it('marks a game sound as one that cannot be heard, and leaves the play button off', async () => {
    const root = await open();
    const main = root.querySelector('[data-ref="/sounds/idle/main"]') as HTMLElement;
    expect(main.getAttribute('data-kind')).toBe('event');
    expect(main.querySelector('[data-testid="sounds-ref-note"]')?.textContent).toBe('a game sound, cannot be played here (minecraft:block.beacon.ambient)');
    expect((main.querySelector('.sounds-play') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('sounds-section-idle').textContent).toContain("Can't be heard: the main sound is a game event.");
    expect(within(screen.getByTestId('sounds-listen-idle')).getByRole<HTMLButtonElement>('button').disabled).toBe(true);
  });

  it('shows a sound for every door of the type, the one without a sound with the engine’s default, and the handles with the engine’s verdict', async () => {
    const root = await open('rwat_example:coach');
    const doors = screen.getByTestId('sounds-section-doors');
    expect([...doors.querySelectorAll('[data-door]')].map((row) => row.getAttribute('data-door'))).toEqual([
      'door_fl',
      'door_fr',
      'door_rl',
      'door_rr',
      'gangway_front',
      'gangway_rear',
      'salon_door',
      'salon_arch',
    ]);
    const arch = doors.querySelector('[data-door="salon_arch"] input') as HTMLInputElement;
    expect(arch.placeholder).toBe('default: an iron door (minecraft:block.iron_door.open and .close)');
    expect(arch.value).toBe('');
    expect(root.querySelector('[data-sound="controls"]')?.textContent).toContain('No keys: the handles are silent.');
  });

  it('judges each control key as the engine does', async () => {
    await open();
    const row = (key: string) => screen.getByTestId(`sounds-control-${key}`);
    expect(row('THROTTLE_1').getAttribute('data-verdict')).toBe('plays');
    expect(row('THROTTLE_1').textContent).toContain('sounds for the handle: throttle');
    expect(row('IND_BRAKE_1').textContent).toContain('independent brake');
    expect(row('WIDGET_1').getAttribute('data-verdict')).toBe('silent');
    expect(row('WIDGET_1').textContent).toContain('silent: a WIDGET handle makes no sound in the game');
  });

  it('changes a range from the keyboard as one command, which undo takes back', async () => {
    await open();
    const ranges = screen.getByTestId('sounds-ranges-idle');
    const first = ranges.querySelector('[data-pointer="/sounds/idle/pitch"] input') as HTMLInputElement;
    expect(first.value).toBe('0.6');
    fireEvent.input(first, { target: { value: '0.7' } });
    fireEvent.change(first, { target: { value: '0.7' } });
    expect(json(SHUNTER).sounds.idle).toMatchObject({ pitch: [0.7, 1.1] });
    await waitFor(() => expect(screen.getByTestId('sounds-effective-idle').textContent).toContain('Pitch: 0.7 → 1.1'));
    journal.value?.undo();
    await waitFor(() => expect(screen.getByTestId('sounds-effective-idle').textContent).toContain('Pitch: 0.6 → 1.1'));
    expect(json(SHUNTER).sounds.idle).toMatchObject({ pitch: [0.6, 1.1] });
    journal.value?.redo();
    expect(json(SHUNTER).sounds.idle).toMatchObject({ pitch: [0.7, 1.1] });
  });

  it('picks a file of the pack for a sound: written as the declaration writes a path in its namespace, the file then playable', async () => {
    const root = await open();
    const select = root.querySelector('[data-ref="/sounds/clack"] select') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(['', OGG]);
    fireEvent.change(select, { target: { value: OGG } });
    expect(json(SHUNTER).sounds.clack).toBe('sounds/horn.ogg');
    const clack = root.querySelector('[data-ref="/sounds/clack"]') as HTMLElement;
    await waitFor(() => expect(clack.getAttribute('data-present')).toBe('true'));
    expect(clack.querySelector('[data-testid="sounds-ref-note"]')?.textContent).toBe('pack file');
    expect((clack.querySelector('.sounds-play') as HTMLButtonElement).disabled).toBe(false);
    journal.value?.undo();
    expect(json(SHUNTER).sounds.clack).toBe('minecraft:block.chain.step');
  });

  it('types an event or a path into a reference, and an emptied box removes an optional one', async () => {
    const root = await open();
    const stop = root.querySelector('[data-ref="/sounds/idle/stop"] input') as HTMLInputElement;
    expect(stop.value).toBe('minecraft:block.beacon.deactivate');
    fireEvent.input(stop, { target: { value: '' } });
    fireEvent.change(stop, { target: { value: '' } });
    expect(json(SHUNTER).sounds.idle).not.toHaveProperty('stop');
    // the shunter's doors have no sound of their own: a row each, the engine's default in the empty box
    const doors = screen.getByTestId('sounds-section-doors');
    expect(doors.querySelectorAll('[data-door]').length).toBeGreaterThan(0);
    expect([...doors.querySelectorAll<HTMLInputElement>('.sounds-ref-input')].every((input) => input.value === '')).toBe(true);
  });

  it('adds a sound to a key the declaration lacks, and removes a whole key', async () => {
    const root = await open('rwat_example:gondola');
    const horn = root.querySelector('[data-ref="/sounds/horn"] input') as HTMLInputElement;
    fireEvent.input(horn, { target: { value: 'minecraft:item.goat_horn.sound.1' } });
    fireEvent.change(horn, { target: { value: 'minecraft:item.goat_horn.sound.1' } });
    expect(json('assets/rwat_example/wagon_models/gondola.json').sounds.horn).toBe('minecraft:item.goat_horn.sound.1');
    await waitFor(() => expect(screen.getByTestId('sounds-section-horn').getAttribute('data-state')).toBe('set'));
    fireEvent.click(within(screen.getByTestId('sounds-section-horn')).getByRole('button', { name: 'Remove the sound: sound' }));
    expect(json('assets/rwat_example/wagon_models/gondola.json').sounds).not.toHaveProperty('horn');
  });

  it('adds a control and a sound for it', async () => {
    const root = await open('rwat_example:gondola');
    const add = screen.getByTestId('sounds-add-control');
    expect([...add.querySelectorAll('option')].map((option) => option.value)).toEqual(['THROTTLE_1', 'TRAIN_BRAKE_1', 'INDEPENDENT_BRAKE_1', 'REVERSER_1']);
    fireEvent.click(within(add).getByRole('button', { name: 'Add a control' }));
    expect(json('assets/rwat_example/wagon_models/gondola.json').sounds.controls).toEqual({ THROTTLE_1: {} });
    const move = await waitFor(() => root.querySelector('[data-ref="/sounds/controls/THROTTLE_1/move"] input') as HTMLInputElement);
    fireEvent.input(move, { target: { value: 'minecraft:block.lever.click' } });
    fireEvent.change(move, { target: { value: 'minecraft:block.lever.click' } });
    expect(json('assets/rwat_example/wagon_models/gondola.json').sounds.controls).toEqual({ THROTTLE_1: { move: 'minecraft:block.lever.click' } });
  });

  it('shows a finding about a key and drops it when the key is mended', async () => {
    await open('rwat_example:coach');
    const doors = screen.getByTestId('sounds-section-doors');
    const first = doors.querySelector('[data-ref="/sounds/doors/door_fl"] input') as HTMLInputElement;
    expect(screen.queryByTestId('sounds-problems-doors')).toBeNull();
    await journal.value?.run({ label: 'x', ops: [{ op: 'remove', file: COACH, at: '/sounds/doors/door_fl' }, { op: 'set', file: COACH, at: '/sounds/doors/door_x', value: 'minecraft:block.piston.contract' }] });
    expect(first).toBeTruthy();
    const found = await screen.findByTestId('sounds-problems-doors');
    expect(found.getAttribute('data-codes')).toBe('loader.door-key');
    expect(found.textContent).toContain('“door_x” is no door of wagon type rwat_example:coach');
    expect(doors.textContent).toContain('no such door in the type');
    journal.value?.undo();
    await waitFor(() => expect(screen.queryByTestId('sounds-problems-doors')).toBeNull());
  });

  it('says why a sound did not play, and stops what plays when the wagon changes or the tab goes', async () => {
    const root = await open();
    const stop = vi.spyOn(audition, 'stopAll');
    fireEvent.change(root.querySelector('[data-ref="/sounds/clack"] select') as HTMLSelectElement, { target: { value: OGG } });
    const play = await waitFor(() => {
      const button = root.querySelector('[data-ref="/sounds/clack"] .sounds-play') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(play);
    // no AudioContext in the test browser: said, not thrown
    await waitFor(() => expect(screen.getByTestId('sounds-error').textContent).toBe('This browser has no WebAudio: listening is not available.'));
    const calls = stop.mock.calls.length;
    openWagon.value = 'rwat_example:gondola';
    await waitFor(() => expect(stop.mock.calls.length).toBeGreaterThan(calls));
    expect(listenError.value).toBeNull();
    cleanup();
    expect(stop.mock.calls.length).toBeGreaterThan(calls + 1);
  });

  it('follows the interface language', async () => {
    await open();
    setLang('ru');
    await waitFor(() => expect(screen.getByTestId('sounds-section-idle').textContent).toContain('Двигатель'));
    expect(screen.getByTestId('sounds-effective-idle').textContent).toBe('Высота: 0.6 → 1.1 (в покое → на полной)Громкость: 0.5 → 1 (в покое → на полной)');
    expect(screen.getByTestId('sounds-section-idle').textContent).toContain('Слышно на 64 блоках.');
  });

  it('sets a loop given as one sound into an object, to take ranges', async () => {
    await open();
    const bell = screen.getByTestId('sounds-section-bell');
    fireEvent.click(within(bell).getByRole('button', { name: 'Set start, stop, pitch and volume' }));
    expect(json(SHUNTER).sounds.bell).toEqual({ main: 'minecraft:block.note_block.flute' });
    await waitFor(() => expect(screen.getByTestId('sounds-ranges-bell')).toBeTruthy());
    const pitch = screen.getByTestId('sounds-ranges-bell').querySelector('[data-pointer="/sounds/bell/pitch"] input') as HTMLInputElement;
    fireEvent.input(pitch, { target: { value: '0.9' } });
    fireEvent.change(pitch, { target: { value: '0.9' } });
    expect(json(SHUNTER).sounds.bell).toMatchObject({ pitch: [0.9, 0] });
  });
});
