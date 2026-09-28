import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = new URL('../src/Lakeland.OrderFulfilment.Api/wwwroot/art/', import.meta.url);
const images = JSON.parse(readFileSync(new URL('gallery.json', base), 'utf8'));
const aliases = {
  'Red and purple needle felt squid': 'Red and purple needle felt squids',
  'Needle felt llama': 'Needle felt llamas',
  'Clay characters in hats': 'Christmas creatures',
  'Banana peel unicorn': 'Banana peel slug',
  'Rabbit breathing galaxy': 'Llama breathing galaxy',
  'Woman blowing butterflies': 'Blowing butterflies',
  'Gandalf needle felt figure': 'Legolas Needle Felt Figure',
  'Pink haired woman abstract background': 'Princess Bubblegum’s realm',
  "Spirited away chihiro and haku": "Spirited Away Chihiro and Haku",
  "John bieniek baby turtles terrarium": "John Bieniek Baby Turtles terrarium",
  "Howls moving castle couple wood plaque": "Cute Couple wood plaque",
  "Howls moving castle": "Howl’s Moving Castle",
  "Lord of the rings needle felt figures": "Lord of the Rings needle felt figures",
  "Rick and morty character collage": "Rick and Morty character collage",
  "Princess mononoke san": "Princess Mononoke San",
  "Katie and gilbert watercolor portrait": "Katie and Gilbert watercolor portrait",
  "Claptrap deadpool crossover sticker": "Claptrap Deadpool crossover sticker",
  "Howl and sophie painted box lid": "Howl and Sophie painted box lid",
  "Studio ghibli character collage": "Ghibli character collage - square",
  "Jon and aiden painted name plaques": "Jon and Aiden - Rick and Morty style name plates",
  "Miniature sculptures art 634 display": "Miniature sculptures Art 634 display",
  "Kettle of the vultures character concept": "Kettle of the Vultures character concept",
  "Ho ho holy crap christmas tree card": "Ho ho holy crap Christmas tree card",
  "Happy whatever blue christmas tree card": "Happy whatever blue Christmas tree card",
  'Bunny hood portrait': 'Tina from Bob’s Burgers',
  'Adventure time princess bubblegum': 'Pearls Vision',
  'Totoro and mei under galaxy sky': 'Totoro and Mei under galaxy sky',
  'The beekeeper and the doctor': 'Beekeeper and doctor',
  'The tallest needle felt giraffes exhibit': 'The tallest',
  'Needle felt giraffes': 'The tallest',
  'Antlered forest spirit original': 'Antlered forest spirit',
  'Antlered forest spirit redraw': 'Antlered Tundra Spirit',
  'Live painting fantasy collaboration': 'Fantasy creatures collaboration',
  'Fantasy creatures on purple canvas': 'Fantasy creatures collaboration',
  'Fantasy creatures coloring page collaboration': 'Fantasy creatures collaboration',
  'Victor ohmbre collaboration in progress': 'Fantasy creatures collaboration'
};
const descriptions = {
  'Monstera babe': 'Monstera babe by Kay Pickett. Includes a work-in-progress video.',
  'Bluey fan art poster': 'A colorful Bluey fan-art poster. Includes a video of the artwork.',
  "Miniature sculptures Art 634 display": 'An overview of the miniature sculpture display at Art 634, including small colorful figures and the Baby Turtles glass terrarium. The two photographs show the display from different positions.',
  "Cute Couple wood plaque": 'A small painted wood plaque featuring a cute, stylized couple.',
  'Memorial tattoo rainbow wings': 'A memorial tattoo concept built around a central letter and a pair of colorful wings. This is a design study from the studio archive.',
  'Farm animal sticker sketches': 'Black-and-white sketches of whimsical farm animals wearing hats, developed as sticker designs.',
  "Howl’s Moving Castle": 'An intricate painting of the wandering castle from Howl’s Moving Castle, with warm pink tones against a pale blue sky.',
  'Self portrait blue background': 'A self-portrait in progress, showing a pale profile against a circular blue background.',
  'Archer acrylic panels': 'A series of acrylic character panels inspired by Archer. The photographs show the panels displayed together.',
  'Christmas creatures': 'A group of small, colorful clay Christmas creatures wearing pointed hats, shown together on the work surface.',
  "Kettle of the Vultures character concept": 'A character concept drawing for The Kettle of the Vultures by E. Sorensen. This archive image shows the portrait in the drawing workspace.',
  'Happy holidays 2024 card': 'A holiday greeting card design combining handwritten-style lettering, a sprig of greenery, and a red ribbon, with a hopeful joke about 2024.',
  "Ho ho holy crap Christmas tree card": 'A row of illustrated green Christmas trees accompanies a tongue-in-cheek greeting about the year.',
  "Happy whatever blue Christmas tree card": 'A loose blue Christmas tree illustration paired with the greeting “Happy Whatever.”',
  'Custom dog portrait ornaments': 'Four round portrait ornaments featuring Athena, King, Fiona, and Koda. Each dog is painted against a different colored background.',
  'Legolas Needle Felt Figure': 'A needle-felt figure inspired by Legolas from The Lord of the Rings.',
  "Claptrap Deadpool crossover sticker": 'A crossover sticker illustration combining Claptrap’s robot form with a Deadpool-inspired design on a bright pink background.',
  'Needle felt llamas': 'Small needle-felt llamas with colorful details.',
  'Llama breathing galaxy': 'A llama sends a cloud of purple and blue stars into the dark space above it.',
  'Art print display': 'A photograph of several studio art prints arranged together, showing a mix of character pieces and imaginative paintings.',
  "Howl and Sophie painted box lid": 'Howl and Sophie from Howl’s Moving Castle painted together on a circular box lid.',
  'Red orange mushrooms': 'Two brightly colored mushrooms with speckled caps stand against a blue-green background.',
  'Tina from Bob’s Burgers': 'A portrait of Tina from Bob’s Burgers wearing a pink bunny-eared hood.',
  'Red haired space babe': 'A red-haired figure in profile against a swirling blue and violet cosmic background.',
  "Spirited Away Chihiro and Haku": 'Chihiro and the dragon Haku from Spirited Away, painted with a vivid turquoise sky and red bridge.',
  'Custom couple portrait with reference': 'A stylized painted couple portrait presented alongside the reference photograph used for the commission.',
  'Custom baby portrait with reference': 'A painted baby portrait shown next to the original reference photograph.',
  'Eat the earth watercolor': 'A watercolor portrait of a blonde figure with a small globe at her lips, titled Eat the Earth in the source post.',
  "Ghibli character collage - square": 'A square collage bringing together characters and scenes inspired by Studio Ghibli films.',
  "Ghibli character collage - round": 'A round collage of characters inspired by Studio Ghibli films. Includes a work-in-progress video.',
  'Pearls Vision': 'A pink-toned painting inspired by Steven Universe. Includes a framed presentation and an artwork view.',
  'Screaming sun mountain landscape': 'A Rick and Morty-inspired mountain landscape featuring the screaming sun between pale peaks beneath a purple sky.',
  "Jon and Aiden - Rick and Morty style name plates": 'Painted name plates for Jon and Aiden, inspired by Rick and Morty.',
  'Princess Bubblegum’s realm': 'Princess Bubblegum in profile beside a flowing, marbled realm of blues, greens, and pinks, inspired by Adventure Time.',
  'Red needle felt mushroom': 'A small needle-felt mushroom with a rounded red cap and pale stem.',
  'Beekeeper and doctor': 'A beekeeper and a plague doctor share a moment beneath blue flowers, with bees around them. Includes the painted piece and a clean-composition display view.',
  'Beekeeper and doctor mug': 'The Beekeeper and Doctor artwork shown on a white glossy mug. Browse mockups of the 11, 15, and 20 oz sizes, different angles, and lifestyle settings. These are design previews; ordering details are still being finalized.',
  'The tallest': 'A pair of long-necked needle-felt giraffes. These photographs show individual figures, the pair together, and their display in the Art 634 fiber-art exhibition.',
  "John Bieniek Baby Turtles terrarium": 'Baby Turtles by John Bieniek: miniature turtles arranged in a glass terrarium, photographed at the Art 634 miniature exhibition.',
  'Baubles crow mixed media': 'A crow in a colorful field, surrounded by a frame of small decorative objects. Includes the exhibited piece and a presentation image.',
  'Antlered forest spirit': 'An antlered figure surrounded by nature in warm tones.',
  'Antlered Tundra Spirit': 'An antlered spirit rendered in cool tones.',
  'Fantasy creatures collaboration': 'A collaborative fantasy composition by Kay Pickett and Victor Ohmbre, featuring whimsical creatures and floating forms. Browse drawing, canvas, and painting-in-progress views.',
  'Labyrinth worm sculpture': 'A small sculpture inspired by the worm from Labyrinth, with blue hair and a red scarf. Alternate views show the character from different sides.',
  "Lord of the Rings needle felt figures": 'A collection of small needle-felt characters inspired by The Lord of the Rings, photographed together from different angles.',
  'Red and purple needle felt squids': 'Red and purple needle-felt squids with long, curling tentacles. Includes individual figures and views of the pair.',
  'Paw pal phone holders': 'Sculpted animal-paw phone holders, with pink paw pads and tiny claws. Browse the designs from different angles and see how they hold a phone.',
  'Banana peel slug': 'A playful little slug emerging from a yellow banana peel. The alternate photographs show its sculpted details from different sides.',
  'Needle felt owl': 'A small needle-felt owl with a rounded body, pale face, and warm brown markings. Browse the front, back, and side views.',
  'Sarcastic holiday card collection': 'A collection of illustrated holiday cards with playful, sarcastic greetings. Browse the group photographs to see the different designs.',
  'Blowing butterflies': 'A woman blows pink butterflies from her hand against a soft blue and violet background.',
  'Mermaid mixed media': 'A floating mermaid with flowing hair and a pink-and-blue tail, created using a mixture of traditional and digital media.',
  "Katie and Gilbert watercolor portrait": 'A colorful watercolor portrait featuring red hair, glasses, flowers, and an animal companion.',
  'Space llama': 'A bright-eyed llama against a deep, star-filled purple sky.',
  'Elephant under aurora': 'An elephant raises its trunk beneath curtains of color in the night sky.',
  'Four eyed pastel cat': 'A pastel-colored cat with four eyes, painted against a soft green background.',
  'Galaxy hair woman profile': 'A woman in profile with flowing hair filled with the colors and stars of a galaxy.',
  'Woodland animals pond acrylic on wood': 'A woodland scene with animals gathered around a pond. The source post describes acrylic on wood with an epoxy-resin finish.',
  "Princess Mononoke San": 'A painted portrait of San from Princess Mononoke, with her red mask and pale fur against a woodland landscape.',
  'Totoro and Mei under galaxy sky': 'Totoro and Mei rest beneath a richly colored, star-filled sky.',
  "Rick and Morty character collage": 'A dense character collage inspired by Rick and Morty, shown in artwork and framed presentation views.'
};
const groups = new Map();
for (const image of images) {
  const title = image.medium === 'Mug design mockup' ? 'Beekeeper and doctor mug' : aliases[image.title] || image.title;
  // Explicit itemId supports future works whose titles happen to be the same.
  const key = image.itemId || `${image.artist}|${image.fanArt}|${title}`;
  if (!groups.has(key)) {
    groups.set(key, {
      id: 'work-' + createHash('sha256').update(key).digest('hex').slice(0, 16),
      title, artist: image.artist, medium: image.medium, fanArt: image.fanArt,
      productId: null, isSample: false,
      description: image.description || descriptions[title] || `${title} by ${image.artist}. ${image.medium === 'Sculpture' ? 'A sculpture from the studio archive.' : 'From the studio’s '+image.medium.toLowerCase()+' collection.'}`,
      images: []
    });
  }
  const group = groups.get(key);
  if (group.images.some(v => v.displaySha256 === image.displaySha256)) continue;
  group.images.push({ image: image.image, width: image.width, height: image.height,
    watermarked: image.watermarked, displaySha256: image.displaySha256,
    label: image.viewLabel || ((aliases[image.title] || image.title) === title ? `View ${group.images.length + 1}` : image.title) });
}
// Keep the Legolas close-ups as supporting views of the LOTR collection.
const lotrFigures = [...groups.values()].find(work => work.title === 'Lord of the Rings needle felt figures');
const legolasEntry = [...groups.entries()].find(([, work]) => work.title === 'Legolas Needle Felt Figure');
if (lotrFigures && legolasEntry) {
  for (const view of legolasEntry[1].images) {
    if (!lotrFigures.images.some(existing => existing.displaySha256 === view.displaySha256))
      lotrFigures.images.push({ ...view, label: 'Legolas Needle Felt Figure' });
  }
  lotrFigures.description += ' Includes close-up views of Legolas.';
  groups.delete(legolasEntry[0]);
}
// Reviewed cover selection uses the original archive view order on every rebuild.
const preferredCoverViews = { 'Rick and Morty character collage': 2, 'Fantasy creatures collaboration': 4, 'Banana peel slug': 2, 'Needle felt llamas': 2, 'Paw pal phone holders': 2 };
for (const work of groups.values()) {
  const index = (preferredCoverViews[work.title] || 1) - 1;
  if (index > 0 && work.images[index]) work.images.unshift(...work.images.splice(index, 1));
}
const fandomsByTitle = {
  'Bluey fan art poster': ['Bluey'],
  "Jon and Aiden - Rick and Morty style name plates": ["Rick and Morty"],
  "Howl’s Moving Castle": [
    "Ghibli"
  ],
  "Labyrinth worm sculpture": [
    "Labyrinth"
  ],
  "Lord of the Rings needle felt figures": [
    "LOTR"
  ],
  "Archer acrylic panels": [
    "Archer"
  ],
  "Rick and Morty character collage": [
    "Rick and Morty"
  ],
  "Princess Mononoke San": [
    "Ghibli"
  ],
  "Legolas Needle Felt Figure": [
    "LOTR"
  ],
  "Claptrap Deadpool crossover sticker": [
    "Borderlands",
    "Deadpool"
  ],
  "Howl and Sophie painted box lid": [
    "Ghibli"
  ],
  "Tina from Bob’s Burgers": [
    "Bob’s Burgers"
  ],
  "Spirited Away Chihiro and Haku": [
    "Ghibli"
  ],
  "Ghibli character collage - round": ["Ghibli"],
  "Ghibli character collage - square": [
    "Ghibli"
  ],
  "Pearls Vision": [
    "Steven Universe"
  ],
  "Screaming sun mountain landscape": [
    "Rick and Morty"
  ],
  "Princess Bubblegum’s realm": [
    "Adventure Time"
  ],
  "Totoro and Mei under galaxy sky": [
    "Ghibli"
  ]
};
const owl = [...groups.values()].find(work => work.title === 'Needle felt owl');
const monstera = [...groups.values()].find(work => work.title === 'Monstera babe');
if (monstera) monstera.images.push({ ...monstera.images[0], type: 'video', video: '/art/display/monstera-babe.mp4', label: 'Monstera babe work-in-progress video' });
const roundGhibli = [...groups.values()].find(work => work.title === 'Ghibli character collage - round');
if (roundGhibli) roundGhibli.images.push({ ...roundGhibli.images[0], type: 'video', video: '/art/display/ghibli-character-collage-round.mp4', label: 'Round collage work-in-progress video' });
const bluey = [...groups.values()].find(work => work.title === 'Bluey fan art poster');
if (bluey) bluey.images.push({ ...bluey.images[0], type: 'video', video: '/art/display/bluey-fan-art-poster.mp4', label: 'Bluey poster video' });
if (owl) owl.images.push({ ...owl.images[0], type: 'video', video: '/art/display/completed-needle-felt-owl.mp4', label: 'Completed owl video' });
const works = [...groups.values()].map(work => ({ ...work, ...work.images[0],
  fandoms: work.fanArt ? (fandomsByTitle[work.title] || ['Other']) : [],
  description: work.description + (work.fanArt ? ' Fan art for appreciation only; not for sale.' : '') }));
writeFileSync(new URL('items.json', base), JSON.stringify(works, null, 2) + '\n');
console.log(`Consolidated ${images.length} image entries into ${works.length} items with ${works.reduce((n,w) => n+w.images.length,0)} distinct views.`);
