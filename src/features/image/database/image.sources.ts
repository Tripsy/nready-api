/**
 * Where the photograph of each seeded product and article comes from.
 *
 * A storefront card showing a random landscape where the laptop should be reads as broken, so
 * the cover art is not random: each product names the Wikimedia Commons file that pictures what
 * it is, keyed by the English label `product.seed.ts` gives it, and each article names one keyed
 * by its English title (`article.seed.ts` `TITLES`).
 *
 * Only the files are chosen here - which rows get an image is still the image seed's business,
 * and it covers part of the catalog on purpose (see `image.seed.ts`). A label or title missing
 * from these lists is not an error: its row falls back to a random picsum photo.
 *
 * The files are fetched by `nready-ui/.claude/scripts/fetch-seed-images.sh`, which asks
 * `cli/list-image-paths.ts` for the URL of each row. They are Commons uploads under their own
 * free licenses (mostly CC BY-SA), which is fine for demo data on a development machine and is
 * the reason none of this may be copied into a real catalog as it stands.
 */

/**
 * One or more files per product. The first is the product's cover; a variant with a cover of its
 * own takes the files after it in turn (`resolveProductPhoto`), so a product listing a single
 * file shows that same picture on its variants.
 */
export const PRODUCT_PHOTOS: Readonly<Record<string, readonly string[]>> = {
	'Anvil Cable Sleeve': ['USB cable with twisttie.jpg'],
	'Aria Desk Lamp': ['Battery powered LED desk lamp-7420.jpg'],
	'Aurora 14 Ultrabook': ['Asus x21 ultrabook.jpg'],
	'Basalt Laptop Stand': ['Laptop stand.jpg'],
	'Beacon Smart Plug': ['Smart-plug.jpg'],
	'Brook Watering Can': ['Metal watering can.jpg'],
	'Cascade USB-C Hub': ['USB-C Hubb 5 portar.jpg'],
	'Cedar Laptop Sleeve': ['Sarung laptop Wikilatih Wikidata Leksem.jpg'],
	'Chilli Sauce': ['All kinds of hot sauce.jpg'],
	'Cirrus Air Purifier': ['Air Purifier (Levoit LV-H133) (49317867758).jpg'],
	'Cobalt Power Strip': ['Daiso triple power strip 3 outlets.jpg'],
	Cola: ['Glass cola.jpg'],
	'Desk Starter Kit': ['Desk setup dc.jpg'],
	'Diavola Pizza': [
		'Pizza Diavola (Verde Ischia).jpg',
		"Pizza Diavola at Alby's Pizza.jpg",
	],
	'Drift Wireless Earbuds': [
		'Fifth-generation AirPods in their charging case.jpg',
	],
	'Ember Electric Kettle': ['Electric kettle - Электрический чайник.JPG'],
	'Ferrite Charging Cable': [
		'Five USB cables with braided jackets in different colours.jpg',
	],
	'Garlic Dip': ['Toum (Lebanese Garlic Sauce).JPG'],
	'Granite Cordless Drill': ['Cordless drill Metabo BS 14,4 Li.JPG'],
	'Halcyon Wireless Headset': [
		'Sony-WH-1000XM3-kabellose-Bluetooth-Noise-Cancelling-Kopfhoerer.5.jpg',
	],
	'Halyard HDMI Cable': ['HDMI Cable.JPG'],
	'Inkwell Inkjet Printer': ['EPSON L1218 Multifunction ink-jet Printer.jpg'],
	'Junction Ethernet Switch': [
		'Ethernet switch Atlantis A02-F5P 5 ports frontend.jpg',
	],
	'Kestrel Webcam': ['USB webcam for PC.jpg'],
	'Lattice Low-Profile Keyboard': ['Backlit keyboard.jpg'],
	'Lumen LED Bulb Pack': ['LED bulbs.jpg'],
	'Margherita Pizza': [
		'Margherita Originale.JPG',
		'Margherita pizza on plate.jpg',
	],
	'Marlin Docking Station': [
		'Lenovo ThinkPad Mini Dock Plus Series 3 with USB 3.0 (Type 4338) 02.jpg',
	],
	'Meridian 27 Monitor': ['HP ProDesk and HP Compaq monitor in library.jpg'],
	'Meridian 32 Monitor': ['Acer V233H-6335.jpg'],
	'Northwind Mechanical Keyboard': ['Mechanical Keyboard.jpg'],
	'Orange Juice': ['Orange juice 1 edit1.jpg'],
	'Orbit 24 Monitor': ['LG L194WT-SF LCD monitor.jpg'],
	'Pallas Studio Microphone': ['Blue Snowflake USB microphone.jpg'],
	'Pizza Night Menu': [
		'Beer and pizza on display in a restaurant on a rustic table with focus on the glass of beer.jpg',
	],
	'Portico Laser Printer': ['Laser printer 2 (8657122708).jpg'],
	'Quattro Formaggi Pizza': [
		'Pizza quattro formaggi at restaurant, Chalk Farm Road, London.jpg',
	],
	'Quill Bluetooth Mouse': ['A wireless computer mouse.jpg'],
	'Solstice Bookshelf Speaker': ['Sony bookshelf speaker.jpg'],
	'Solstice Cotton T-Shirt': [
		'Wiki Loves Bangla T-Shirt White.jpg',
		'Ambigram Ideal, polysymmetrical logo printed on a green T-shirt.jpg',
		'Ambigram Zen Yes text with meditation pictogram, embroidered on a blue T-shirt.jpg',
	],
	'Sparkling Water': ['Sparkling Water with Mint in Glass Cup.jpg'],
	'Summit Over-Ear Headphones': ['Headphones on desk.jpg'],
	'Tempo Soundbar': ['LG IPS LCD 4K TV & SAMSUNG SOUNDBAR HW-J250.jpg'],
	'Tessellate Desk Mat': ['Desk Setup (Unsplash).jpg'],
	'Thicket Garden Trimmer': ['BnDHedgeTrimmerExtended.JPG'],
	'Vector Gaming Mouse': [
		'2023 Mysz komputerowa Logitech G903 Lightspeed.jpg',
	],
	'Vellum Document Scanner': ['Kurzweil scanner 01.jpg'],
};

/**
 * The photograph at the top of each seeded article, keyed by its English title. Landscape files
 * where Commons had one, since the cover is cropped to 16:9.
 */
export const ARTICLE_PHOTOS: Readonly<Record<string, string>> = {
	'Choosing a laptop that lasts': 'Laptop open servicing.jpg',
	'Five accessories worth the desk space': 'Desk setup dv.jpg',
	'How we test battery life':
		'Fujitsu Siemens Computers Amilo L7300 - Lithium ion battery-0150.jpg',
	'A short guide to mechanical keyboards': 'MX brown key switches.jpg',
	'What changed in this year’s monitors':
		'RGB desktop computer setup with keyboard and monitor.jpg',
	'Cable management without the clutter': 'Kabelsalat.jpg',
	'Picking a printer you will not resent':
		'Servicing the old office printer.jpg',
	'The case for a second screen':
		'Dual monitor setup in a gaming room with keyboard and mouse in focus.jpg',
	'Storage: fast, large, or cheap':
		'Vertex 2 Solid State Drive by OCZ-top oblique PNr°0307.jpg',
	'Headphones for an open office': 'หวญ 03-45 A Large Open-plan Office.jpg',
	'Webcams that survive daylight':
		'Woman smiling and using laptop during video call in cozy wooden room.jpg',
	'Keeping a workstation quiet':
		'Corsair Logo 120mm desktop computer case fan (52504601012).jpg',
	'Docking stations, ranked by regret':
		'Rear ports of a Dell D-Dock PD01X Expansion Station.jpg',
	'When a mouse is worth replacing': 'Acer computer mouse on paper.jpg',
	'Reading the fine print on warranties':
		'Synco Appliance warranty face 20170718.jpg',
	'Desk lamps and the color of light':
		'Incandescent bulb lamp glowing on a desk at night.jpg',
	'A chair you will still like in year three':
		'Desk chair by Frank Lloyd Wright, V&A London.jpg',
	'Backups that actually get restored': '35-Desktop-Hard-Drive.jpg',
	'Notes on refurbished hardware': 'Computer repair in progress.jpg',
	'Two machines, one keyboard':
		'Computer keyboard, smart card reader, and mouse on a wooden desk.jpg',
	'What a good return policy looks like':
		'Flipper Zero retail cardboard packaging box top view.jpg',
	'Cheap cables and expensive lessons':
		'USB-C cable connected to a powerbank.jpg',
	'Standing desks after the novelty': 'Standing Desk by Amrish Kawa 06.jpg',
	'Colour accuracy without the ceremony': 'ColorHug2 - 03.jpg',
	'The quiet case for wired networking': 'Ethernet switch 2.jpg',
	'Buying storage you will not outgrow': 'Hard disk head crash.jpg',
	'Laptop bags that survive a commute':
		'Laptop backpacks from Mr. DIY at Ayala Center Cebu (2025-02-24).jpg',
	'Screen sizes and the space you have': 'Old office setup (51381253924).jpg',
};

/**
 * The Commons file picturing a product, or null when none is listed for its label.
 *
 * `variantIndex` is null for the product's own cover. For a variant it is that variant's place
 * among the variants of the same product that carry a cover (0, 1, ...): they cycle through the
 * product's files starting from the second, so a variant photographed beside its product shows a
 * different picture where the product lists more than one.
 */
export function resolveProductPhoto(
	label: string,
	variantIndex: number | null,
): string | null {
	const photos = PRODUCT_PHOTOS[label];

	if (!photos?.length) {
		return null;
	}

	if (variantIndex === null) {
		return photos[0];
	}

	return photos[(variantIndex + 1) % photos.length];
}

/**
 * The Commons file picturing an article, or null when none is listed for its title. The seed
 * wraps its title list and appends ` (part N)` on later passes, so that suffix is dropped before
 * the lookup - every pass of a title shows the same subject.
 */
export function resolveArticlePhoto(title: string): string | null {
	return ARTICLE_PHOTOS[title.replace(/ \(part \d+\)$/, '')] ?? null;
}

/** Commons' stable redirect to a file, scaled down to `width` pixels wide. */
const COMMONS_FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath';

export function buildCommonsPhotoUrl(file: string, width: number): string {
	return `${COMMONS_FILE_PATH}/${encodeURIComponent(file)}?width=${width}`;
}
