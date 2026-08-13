import { el, clear } from '../util/dom.ts';

type Entry = [keys: string[], description: string];

const SECTIONS: [string, Entry[]][] = [
  [
    'Navigation',
    [
      [['Tab'], 'Switch orbit / walk'],
      [['W', 'A', 'S', 'D'], 'Walk (hold Shift to move faster)'],
      [['Q', 'E'], 'Lower / raise eye height (scroll works too)'],
      [['drag'], 'Look around — click the view first for pointer lock'],
      [['Esc'], 'Release pointer lock'],
      [['dbl-click'], 'Orbit mode: set the pivot to that point'],
      [['F'], 'Frame the whole scene'],
    ],
  ],
  [
    'Colour',
    [
      [['click'], 'Select a wall and open its picker'],
      [['1', '2', '3'], 'Apply scheme slot 1 / 2 / 3'],
      [['R'], 'Reset the selected wall to its exported colour'],
      [['T'], 'Tone mapping on / off (off = literal hex)'],
      [['P'], 'Save a 2× PNG screenshot'],
    ],
  ],
  [
    'Other',
    [
      [['`'], 'Debug panel + FPS meter'],
      [['?'], 'This list'],
      [['drop .glb'], 'Load a scene · drop .json to import settings'],
    ],
  ],
];

/** Keyboard reference, toggled with `?`. */
export class HelpOverlay {
  constructor(private root: HTMLElement) {
    this.render();
    root.addEventListener('click', () => this.hide());
  }

  private render(): void {
    const grid = el('div', { class: 'help-grid' });
    for (const [title, entries] of SECTIONS) {
      grid.appendChild(el('h3', { text: title }));
      for (const [keys, description] of entries) {
        grid.append(
          el(
            'div',
            { class: 'keys' },
            keys.map((k) => el('span', { class: 'kbd', text: k })),
          ),
          el('span', { text: description }),
        );
      }
    }

    clear(this.root);
    this.root.appendChild(
      el('div', { class: 'help-card' }, [
        el('h2', { text: 'Repaint' }),
        el('p', {
          class: 'sub',
          text: 'Drop a Blender .glb with PAINT_ materials. Click anywhere to dismiss.',
        }),
        grid,
      ]),
    );
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get isVisible(): boolean {
    return !this.root.hidden;
  }
}
