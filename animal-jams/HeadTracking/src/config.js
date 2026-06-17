export const CONFIG = {
  targetUrl: 'https://apps.apple.com/us/app/animal-jam/id1003820457',

  canvas: { width: 720, height: 1280 },

  // Brand palette
  brand: {
    parchment: '#f5e6c8',
    orange:    '#f7941d',
    green:     '#5db33b',
    brown:     '#7b4c2a',
    darkBrown: '#5a3010',
    font:      '"Tiki Island", Impact, Arial Black, sans-serif',
    fontDimbo: '"Dimbo", Impact, Arial Black, sans-serif',
    fontBody:  '"CC Digital Delivery", Arial, sans-serif',
  },

  pets: [
    {
      id: 'cow',
      label: 'Cow',
      atlases: ['texture-pet1-1', 'texture-pet1-2'],
      sound: 'assets/audio/pet-1-sound.mp3',
      headOffsets: [0, 0, 0],
      tiltMultiplier: 0.35,
      accessories: [
        { label: 'Flowers',  topShift: [2,   0,  -36], sideShift: [-7, -10, -11] },
        { label: 'Visor',    topShift: [-17, -16, -71], sideShift: [-1,  -7,  -2] },
        { label: 'Bow Tie',  topShift: [1,   0,  -37], sideShift: [0,   0,   7] },
      ],
    },
    {
      id: 'fennec',
      label: 'Fox',
      atlases: ['texture-pet2-1', 'texture-pet2-2'],
      sound: 'assets/audio/pet-2-sound.mp3',
      headOffsets: [0, 0, 0],
      tiltMultiplier: 0.35,
      accessories: [
        { label: 'Tiki Hat', topShift: [11,   2,  -8], sideShift: [-5, -13,  -5] },
        { label: 'Pharaoh',  topShift: [-22, -18, -34], sideShift: [-5,  -9,  -5] },
        { label: 'Crown',    topShift: [5,    3,  -8], sideShift: [-7, -11,  -4] },
      ],
    },
    {
      id: 'seal',
      label: 'Seal',
      atlases: ['texture-pet3-1', 'texture-pet3-2'],
      sound: 'assets/audio/pet-3-sound.mp3',
      headOffsets: [0, 0, 0],
      tiltMultiplier: -0.55,
      accessories: [
        { label: 'Glasses',    topShift: [-28, -20, -49], sideShift: [-7, -7,  3] },
        { label: 'Unicorn',    topShift: [17,   27,  -7], sideShift: [-7, -5,  4] },
        { label: 'Garden Hat', topShift: [2,     9, -13], sideShift: [-8, -4,  6] },
      ],
    },
  ],

  // 3 colors match the actual idle-1 / idle-2 / idle-3 sprite variants:
  // idle-1 = natural/tan, idle-2 = warm brown/orange, idle-3 = dark red
  colors: [
    { id: 'natural', label: 'Natural', sprite: 'color_bezj.png',  hex: '#d4b483', idleVariant: 1 },
    { id: 'brown',   label: 'Brown',   sprite: 'color_brown.png',  hex: '#8b5e3c', idleVariant: 2 },
    { id: 'red',     label: 'Red',     sprite: 'color_red.png',    hex: '#e05050', idleVariant: 3 },
  ],

  anim: {
    idleFps:      12,
    clickFps:     18,
    accessoryFps: 14,
    danceFps:     14,
    hopFps:       14,
  },

  // Game icon cards — real Animal Jam game images
  gameCards: [
    { title: 'Best Dressed',      image: 'assets/ui/games/best_dressed.png'    },
    { title: 'Roll!!!!!',         image: 'assets/ui/games/roll.png'             },
    { title: 'Pest Control',      image: 'assets/ui/games/pest_control.png'     },
    { title: "A Puppy's Tale",    image: 'assets/ui/games/puppys_tale.png'      },
    { title: 'Fast Foodies',      image: 'assets/ui/games/fast_foodies.png'     },
    { title: 'Temple of Trivia',  image: 'assets/ui/games/temple_of_trivia.png' },
  ],
  carouselScrollSpeed: 140, // px per second (snappier)
  carouselDuration:    8,   // seconds before CTA (slightly longer for new layout)

  audio: {
    bgMusic: 'assets/audio/sound-bg.mp3',
    cheer:   'assets/audio/audience_cheer_01_LKFS.mp3',
    jump:    'assets/audio/avatar_jump_LKFS.mp3',
    balloon: 'assets/audio/balloon_bounce_01_LKFS.mp3',
    bell:    'assets/audio/bell_tree_gliss_01_LKFS.mp3',
    suction: 'assets/audio/suction_cup_LKFS.mp3',
    timpani: 'assets/audio/timpani_bounce_01_LKFS.mp3',
  },
};
