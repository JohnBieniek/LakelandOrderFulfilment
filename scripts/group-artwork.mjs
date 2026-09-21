import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = new URL('../src/Lakeland.OrderFulfilment.Api/wwwroot/art/', import.meta.url);
const images = JSON.parse(readFileSync(new URL('gallery.json', base), 'utf8'));
const aliases = {
  'The beekeeper and the doctor': 'Beekeeper and doctor',
  'The tallest needle felt giraffes exhibit': 'Needle felt giraffes',
  'Antlered forest spirit original': 'Antlered forest spirit',
  'Antlered forest spirit redraw': 'Antlered forest spirit',
  'Live painting fantasy collaboration': 'Fantasy creatures collaboration',
  'Fantasy creatures on purple canvas': 'Fantasy creatures collaboration',
  'Fantasy creatures coloring page collaboration': 'Fantasy creatures collaboration',
  'Victor ohmbre collaboration in progress': 'Fantasy creatures collaboration'
};
const descriptions = {
  'Miniature sculptures art 634 display': 'An overview of the miniature sculpture display at Art 634, including small colorful figures and the Baby Turtles glass terrarium. The two photographs show the display from different positions.',
  'Howls moving castle couple wood plaque': 'A small painted wood plaque featuring a stylized couple inspired by Howl’s Moving Castle.',
  'Memorial tattoo rainbow wings': 'A memorial tattoo concept built around a central letter and a pair of colorful wings. This is a design study from the studio archive.',
  'Farm animal sticker sketches': 'Black-and-white sketches of whimsical farm animals wearing hats, developed as sticker designs.',
  'Howls moving castle': 'An intricate painting of the wandering castle from Howl’s Moving Castle, with warm pink tones against a pale blue sky.',
  'Self portrait blue background': 'A self-portrait in progress, showing a pale profile against a circular blue background.',
  'Archer acrylic panels': 'A series of acrylic character panels inspired by Archer. The photographs show the panels displayed together.',
  'Clay characters in hats': 'A group of small, colorful clay characters wearing pointed hats, shown together on the work surface.',
  'Kettle of the vultures character concept': 'A character concept drawing for The Kettle of the Vultures by E. Sorensen. This archive image shows the portrait in the drawing workspace.',
  'Happy holidays 2024 card': 'A holiday greeting card design combining handwritten-style lettering, a sprig of greenery, and a red ribbon, with a hopeful joke about 2024.',
  'Ho ho holy crap christmas tree card': 'A row of illustrated green Christmas trees accompanies a tongue-in-cheek greeting about the year.',
  'Happy whatever blue christmas tree card': 'A loose blue Christmas tree illustration paired with the greeting “Happy Whatever.”',
  'Custom dog portrait ornaments': 'Four round portrait ornaments featuring Athena, King, Fiona, and Koda. Each dog is painted against a different colored background.',
  'Gandalf needle felt figure': 'A small Gandalf-inspired needle-felt figure with a pointed hat, pale beard, and staff.',
  'Claptrap deadpool crossover sticker': 'A crossover sticker illustration combining Claptrap’s robot form with a Deadpool-inspired design on a bright pink background.',
  'Needle felt llama': 'A small pale needle-felt llama with contrasting dark details and a purple saddle blanket. Includes two viewing angles.',
  'Rabbit breathing galaxy': 'A rabbit sends a cloud of purple and blue stars into the dark space above it.',
  'Art print display': 'A photograph of several studio art prints arranged together, showing a mix of character pieces and imaginative paintings.',
  'Howl and sophie painted box lid': 'Howl and Sophie from Howl’s Moving Castle painted together on a circular box lid.',
  'Red orange mushrooms': 'Two brightly colored mushrooms with speckled caps stand against a blue-green background.',
  'Bunny hood portrait': 'A portrait of a young character wearing a tall, pink bunny-eared hood.',
  'Red haired space babe': 'A red-haired figure in profile against a swirling blue and violet cosmic background.',
  'Spirited away chihiro and haku': 'Chihiro and the dragon Haku from Spirited Away, painted with a vivid turquoise sky and red bridge.',
  'Custom couple portrait with reference': 'A stylized painted couple portrait presented alongside the reference photograph used for the commission.',
  'Custom baby portrait with reference': 'A painted baby portrait shown next to the original reference photograph.',
  'Eat the earth watercolor': 'A watercolor portrait of a blonde figure with a small globe at her lips, titled Eat the Earth in the source post.',
  'Studio ghibli character collage': 'A colorful collage bringing together characters and scenes inspired by Studio Ghibli films.',
  'Adventure time princess bubblegum': 'A pink-toned painting inspired by Princess Bubblegum from Adventure Time. Includes a framed presentation and an artwork view.',
  'Screaming sun mountain landscape': 'A wide mountain landscape with a expressive yellow sun rising between pale peaks beneath a purple sky.',
  'Jon and aiden painted name plaques': 'Two dark painted name plaques with hand-lettered names, Jon and Aiden.',
  'Pink haired woman abstract background': 'A pink-haired figure in profile beside a flowing, marbled field of blues, greens, and pinks.',
  'Red needle felt mushroom': 'A small needle-felt mushroom with a rounded red cap and pale stem.',
  'Beekeeper and doctor': 'A beekeeper and a plague doctor share a moment beneath blue flowers, with bees around them. Includes the painted piece and a clean-composition display view.',
  'Beekeeper and doctor mug': 'The Beekeeper and Doctor artwork shown on a white glossy mug. Browse mockups of the 11, 15, and 20 oz sizes, different angles, and lifestyle settings. These are design previews; ordering details are still being finalized.',
  'Needle felt giraffes': 'A pair of long-necked needle-felt giraffes. These photographs show individual figures, the pair together, and their display in the Art 634 fiber-art exhibition.',
  'John bieniek baby turtles terrarium': 'Baby Turtles by John Bieniek: miniature turtles arranged in a glass terrarium, photographed at the Art 634 miniature exhibition.',
  'Baubles crow mixed media': 'A crow in a colorful field, surrounded by a frame of small decorative objects. Includes the exhibited piece and a presentation image.',
  'Antlered forest spirit': 'An antlered figure surrounded by nature. This set brings together the warm-toned original and its later, cool-toned redraw so you can compare the two interpretations.',
  'Fantasy creatures collaboration': 'A collaborative fantasy composition by Kay Pickett and Victor Ohmbre, featuring whimsical creatures and floating forms. Browse drawing, canvas, and painting-in-progress views.',
  'Labyrinth worm sculpture': 'A small sculpture inspired by the worm from Labyrinth, with blue hair and a red scarf. Alternate views show the character from different sides.',
  'Lord of the rings needle felt figures': 'A collection of small needle-felt characters inspired by The Lord of the Rings, photographed together from different angles.',
  'Red and purple needle felt squid': 'Red and purple needle-felt squid with long, curling tentacles. Includes individual figures and views of the pair.',
  'Paw pal phone holders': 'Sculpted animal-paw phone holders, with pink paw pads and tiny claws. Browse the designs from different angles and see how they hold a phone.',
  'Banana peel unicorn': 'A playful little unicorn emerging from a yellow banana peel. The alternate photographs show its sculpted details from different sides.',
  'Needle felt owl multiple views': 'A small needle-felt owl with a rounded body, pale face, and warm brown markings. These presentation images show several sides of the figure.',
  'Sarcastic holiday card collection': 'A collection of illustrated holiday cards with playful, sarcastic greetings. Browse the group photographs to see the different designs.',
  'Woman blowing butterflies': 'A woman blows pink butterflies from her hand against a soft blue and violet background.',
  'Mermaid mixed media': 'A floating mermaid with flowing hair and a pink-and-blue tail, created using a mixture of traditional and digital media.',
  'Katie and gilbert watercolor portrait': 'A colorful watercolor portrait featuring red hair, glasses, flowers, and an animal companion.',
  'Space llama': 'A bright-eyed llama against a deep, star-filled purple sky.',
  'Elephant under aurora': 'An elephant raises its trunk beneath curtains of color in the night sky.',
  'Four eyed pastel cat': 'A pastel-colored cat with four eyes, painted against a soft green background.',
  'Galaxy hair woman profile': 'A woman in profile with flowing hair filled with the colors and stars of a galaxy.',
  'Woodland animals pond acrylic on wood': 'A woodland scene with animals gathered around a pond. The source post describes acrylic on wood with an epoxy-resin finish.',
  'Princess mononoke san': 'A painted portrait of San from Princess Mononoke, with her red mask and pale fur against a woodland landscape.',
  'Totoro and mei under galaxy sky': 'Totoro and Mei rest beneath a richly colored, star-filled sky.',
  'Rick and morty character collage': 'A dense character collage inspired by Rick and Morty, shown in artwork and framed presentation views.'
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
    label: image.title === title ? `View ${group.images.length + 1}` : image.title });
}
const works = [...groups.values()].map(work => ({ ...work, ...work.images[0],
  description: work.description + (work.fanArt ? ' Fan art for appreciation only; not for sale.' : '') }));
writeFileSync(new URL('items.json', base), JSON.stringify(works, null, 2) + '\n');
console.log(`Consolidated ${images.length} image entries into ${works.length} items with ${works.reduce((n,w) => n+w.images.length,0)} distinct views.`);
