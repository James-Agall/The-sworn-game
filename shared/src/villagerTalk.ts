// villagerTalk.ts: what a settlement villager has to say. Pure data + pure picking, shared by the server (dialogue
// tokens filled in herolife.ts) and tests. A villager is given a TRADE from a hash of its id (stable for life), and every
// answer is chosen from lines that depend on that trade, the weather, the time of day, the season, the settlement's tier
// and buildings, and who else lives there. Gossip and greetings rotate by game day so a second visit does not repeat
// the first. Original wording; the structure (hub menu, role flavour, weather / season lines, rotating gossip) follows how
// Stardew Valley, Kingdom Come and Mount & Blade keep short conversations alive.
import type { BuildingType } from "./buildingTemplates.js";

export interface VillagerTrade {
  id: string;
  // "a farmer": goes after "I'm {npc}, ..."
  noun: string;
  // How the work goes, in fair weather and in foul (rain, storm, snow, fog).
  work: [string, string];
  // A detail of the craft, for the "tell me more" follow-up.
  craft: string;
  // What troubles this kind of person.
  worry: string[];
  // A line about themselves, for friends.
  past: string;
}

export const VILLAGER_TRADES: VillagerTrade[] = [
  { id: "farmer", noun: "a farmer",
    work: ["\"The soil is dry enough to turn today. A good day's furrow is worth more than any coin.\"", "\"Mud to the knee and the barley still wet. I'm out anyway; the weeds don't wait.\""],
    craft: "\"Rotate the fields, spare the seed corn, and never plant on the day the crows are loud. My father's rules, and the barn has never been empty yet.\"",
    worry: ["\"Wolves at the sheepfolds and blight on the south field. If the blight comes north, we'll be eating bark by spring.\"", "\"Somebody cut the fence by the east field. Wolves don't carry shears.\""],
    past: "\"I was born in the house with the green door. Never wanted to be anywhere else, though I'd have liked to see the sea once.\"" },
  { id: "shepherd", noun: "a shepherd",
    work: ["\"The flock is quiet and the grass is sweet. Days like this I could sleep standing up.\"", "\"Rain in the wool, and every ewe thinks she's the only one. Come back when they've settled.\""],
    craft: "\"A good dog is worth three lads. Mine counts the flock better than I do, and never asks for a share of the cheese.\"",
    worry: ["\"I lost two lambs last week. No blood, no tracks. I don't care for that.\"", "\"Raiders take a flock before they take a barn. Keep your eye on the high pasture.\""],
    past: "\"My grandmother taught me the high paths. She'd walk them blind and never lose a sheep. I still lose one a year and think of her.\"" },
  { id: "woodcutter", noun: "a woodcutter",
    work: ["\"Dry timber rings when it falls. Listen. Hear that? That's money.\"", "\"Wet wood, slick bark, and an axe in my hand. I'd rather be by the fire, truth be told.\""],
    craft: "\"Fell it away from the path, trim from the top, and always know which way it wants to fall. The tree decides, not you.\"",
    worry: ["\"The forest edge creeps closer each year, and things come out of it that I don't have names for.\"", "\"I found a camp in the deep wood. Cold ashes, but fresh. Somebody is watching the road.\""],
    past: "\"I lost two fingers to a green oak in my youth. Best lesson I ever had, and the cheapest.\"" },
  { id: "miller", noun: "the miller",
    work: ["\"The wheel turns, the grain flows, and every house in {site} eats because of it. No pressure.\"", "\"The stream's running high, and the wheel groans like an old goat. If it breaks, the whole village goes hungry.\""],
    craft: "\"Grind slow and the flour stays sweet. Grind fast and you've burned it. It's patience, mostly, and a good ear for the stones.\"",
    worry: ["\"Flour dust in the lungs. I'll not see sixty, but the village will eat.\"", "\"A stranger wanted to know how much grain we keep in store. I told him none of his business.\""],
    past: "\"This mill was my wife's father's. The stones were cut by hand, and I am only their keeper.\"" },
  { id: "weaver", noun: "a weaver",
    work: ["\"The loom clacks, the thread runs, and I hear the whole village in the rhythm. Quiet day.\"", "\"A grey day makes the dye look dull, but wool takes the damp well enough. I'll weave on.\""],
    craft: "\"Madder for red, woad for blue, and the yellow comes from a weed I won't name. Every colour has a secret and a smell.\"",
    worry: ["\"Traders skimp on the dye. A cloak that fades in a season is a cheat and a shame.\"", "\"Moths in the winter store. Lavender, cedar, anything. I'd burn the lot before I'd lose it to moths.\""],
    past: "\"I wove my own wedding cloth. It's folded in the chest and I won't sell it, whatever you offer.\"" },
  { id: "mason", noun: "a mason",
    work: ["\"Stone doesn't care for hurry. Set it right once and it outlives your grandchildren.\"", "\"Rain's no friend to mortar, so I'm sorting stones and sulking. Come back tomorrow for the real work.\""],
    craft: "\"A wall is a lie unless the heart stones are laid true. Anyone can face a wall. It's the rubble in the middle that holds it up.\"",
    worry: ["\"The old wall is cracking where the roots got in. One hard winter and a piece will come down.\"", "\"I'm asked to build for the elder but paid in promises. Stone has to be bought, even if the work is free.\""],
    past: "\"I learned the trade under a master who'd built chapels. He said every stone is a prayer. I thought he was daft. I don't any more.\"" },
  { id: "herbalist", noun: "the herbalist",
    work: ["\"Rain brings the moss and the mushrooms out. A grim day for walking, a good one for foraging.\"", "\"Dry weather, dry leaves. Fine for hanging a bundle, poor for fresh cuttings. I'll go out at dusk.\""],
    craft: "\"Yarrow stops the bleeding, willow bark takes the fever, and I won't tell you what the red berries are for. Ask me if you must.\"",
    worry: ["\"Folk go to the hedge-witch before they come to me. Then they come to me when it's too late.\"", "\"Some of the old herbs won't grow any more. The ground has gone sour near the north wood.\""],
    past: "\"I came here with one bad arm and a satchel of seeds. Fifteen winters later, half the village owes me a favour.\"" },
  { id: "beekeeper", noun: "the beekeeper",
    work: ["\"The hives are loud, which means they're happy. Don't flap your hands, friend. They can tell.\"", "\"Bees stay in on a day like this, and so do I. Honey doesn't make itself and the smoke pot is damp.\""],
    craft: "\"Smoke them gently, speak low, and always tell them the news. Births, deaths, weddings. Bees are touchy about being the last to know.\"",
    worry: ["\"A cold spring and half the colonies are gone. I'll be sorry for it all year.\"", "\"Somebody's been at my hives at night. Honey I could stand to lose. The bees, no.\""],
    past: "\"My mother kept bees, and her mother too. They don't sting me. They know me, I suppose.\"" },
  { id: "cooper", noun: "the cooper",
    work: ["\"Tap, tap, tap. A good barrel never leaks, never rattles, and never lets the ale go sour. I'm proud of that.\"", "\"Damp air swells the staves, which is fine for a barrel and terrible for my temper.\""],
    craft: "\"Oak for ale, ash for dry goods, and never use a stave with a knot. A knot will weep at the worst possible moment.\"",
    worry: ["\"Good oak is harder to find. The woodcutters have to go further each year, and the price follows.\"", "\"The brewer wants fifty barrels by harvest. Fifty! I only have two hands.\""],
    past: "\"I wanted to be a knight, once. Then I found out how much a good barrel sells for.\"" },
  { id: "potter", noun: "the potter",
    work: ["\"A fine dry day for the kiln. The clay is willing and so, for once, am I.\"", "\"Wet weather and wet clay: a poor pair. I'll shape what I can and fire it when the sky clears.\""],
    craft: "\"The wheel gives the shape, the fire gives the strength, and the glaze gives the pride. Skip any one and you're left with a very ugly cup.\"",
    worry: ["\"The clay bank by the river is thinning out. I'll have to dig further upstream.\"", "\"A cracked pot in the kiln is a heartbreak. Three this month. I'm blaming the weather.\""],
    past: "\"My first pot looked like a drowned cat. My teacher kept it on the shelf to humble me. It worked.\"" },
  { id: "hunter", noun: "a hunter",
    work: ["\"Quiet wood, fresh tracks. If you want to see a deer, stand still and think about nothing.\"", "\"Rain washes the scent away, which is good for me and worse for the hounds. I'll still go.\""],
    craft: "\"Read the ground first, the wind second, the wood third. A trail tells you what was here, who was chasing, and how afraid it was.\"",
    worry: ["\"The deer are thin and the wolves are bold. Something's driving them down from the high ground.\"", "\"I found a snare that wasn't mine. Someone from outside has been working my woods.\""],
    past: "\"I came out of the forest at sixteen with a bow and a bad temper. The bow I kept.\"" },
  { id: "baker", noun: "the baker",
    work: ["\"Warm loaves, warm hands, warm temper. The oven wakes before the rooster does.\"", "\"A grey day sends everyone to the bakery for something hot. I'm run off my feet and not complaining.\""],
    craft: "\"The dough knows what the weather is doing, and so do I. Wet days need less water, cold days more patience.\"",
    worry: ["\"Flour is dear and the miller blames the harvest. I blame the miller.\"", "\"The oven's flue is cracking. If it fails I'll be baking in a neighbour's kitchen, and a neighbour's cat.\""],
    past: "\"I've fed this village for thirty years. They'll forgive anything but a burned crust.\"" },
];

const TRADE_BY_ID = new Map(VILLAGER_TRADES.map((t) => [t.id, t]));

export interface VillagerCtx {
  // Stable per villager (a hash of its id).
  seed: number;
  // Game day, so gossip and greetings rotate.
  day: number;
  night: boolean;
  weather: string;
  // Season index 0-3 (spring, summer, autumn, winter) or -1 when the calendar is off.
  season: number;
  // Settlement tier 1-3 (hamlet / village / town).
  tier: 1 | 2 | 3;
  // Names of other people in the settlement (for gossip).
  neighbours: string[];
  // Types of building in the settlement, for "where can I find ...".
  amenities: BuildingType[];
  elder: string;
}

const pick = <T,>(a: T[], n: number): T => a[((n % a.length) + a.length) % a.length];
const foul = (w: string) => w === "rain" || w === "storm" || w === "snow" || w === "fog";

export function villagerTrade(seed: number, preferred?: string): VillagerTrade {
  return (preferred ? TRADE_BY_ID.get(preferred) : undefined) ?? pick(VILLAGER_TRADES, seed);
}

const HELLO_DAY = [
  "\"Fair day to you. I'm {npc}, {trade} of {site}.\"",
  "\"Hello there! {npc}, {trade}. You look like you've come a way.\"",
  "\"Well met, traveller. {npc} is the name, and {trade} is the trade.\"",
  "\"Don't often see new faces. I'm {npc}, {trade} in {site}. What can I do for you?\"",
];
const HELLO_NIGHT = [
  "\"Late to be about. I'm {npc}, {trade}, and I should be abed.\"",
  "\"You'll want to be indoors soon. I'm {npc}, {trade} of {site}. Mind the dark.\"",
  "\"By the light of one lantern... well, I'm {npc}. Don't wander far tonight.\"",
];
const HELLO_FOUL: Record<string, string> = {
  rain: "\"Terrible weather to be out. I'm {npc}, {trade}. Come in under the eave a moment.\"",
  storm: "\"The wind has teeth today. {npc}, {trade} of {site}. Keep your hood up.\"",
  snow: "\"Cold enough to freeze the words in your mouth. I'm {npc}, {trade}. Warm yourself.\"",
  fog: "\"Can't see my own hands in this murk. {npc}, {trade}. Is that you, stranger?\"",
};
const SKY: Record<string, string[]> = {
  clear: ["\"Clear skies and a light wind. If you were hoping for an excuse to complain, you'll have to find another.\"", "\"Good weather holds the village together. Fewer tempers, more work done.\""],
  rain: ["\"Rain. It'll fill the wells and ruin my boots. I'm of two minds.\"", "\"Good for the crops, bad for the roads. The ford will be up by evening, mark me.\""],
  storm: ["\"Storms like this flood the ford. Don't cross before dawn, and don't shelter under the big oak.\"", "\"Everyone's indoors. The fire is the busiest soul in the village.\""],
  snow: ["\"Snow. The road to the next village will be shut by morning. Plan on staying a while.\"", "\"Hush of snow, smell of woodsmoke. If it weren't so cold I'd call it peaceful.\""],
  fog: ["\"Fog like this hides all manner of things. Keep a hand on your purse and one on your sword.\"", "\"The old folk say fog is the breath of the barrow. I say it's the damp. Either way, take care.\""],
};
const SEASON_LINE = [
  "\"It's the sowing season. Spring comes slowly, but when it does, everybody's up before dawn.\"",
  "\"Summer. Long days, short tempers, and the hay isn't going to cut itself.\"",
  "\"Autumn. Harvest is in, or nearly. After that, the long dark.\"",
  "\"Winter. Stores counted, wood stacked. We'll see who was careful in the autumn.\"",
];
const NIGHT_SKY = "\"Best be indoors after dark. The village keeps its own counsel at night, and the woods keep theirs.\"";

// Gossip: every line names a neighbour, and rotates by day. {a} and {b} are two different neighbours (or "someone" when alone).
const GOSSIP = [
  "\"I hear {a} was seen leaving {b}'s house before dawn. Say nothing, but I thought you ought to know.\"",
  "\"{a} swears the old well is haunted. {b} swears {a} is drunk. I'm not saying either is wrong.\"",
  "\"{a} has been counting coin by lantern light for a week. Either a windfall or a worry.\"",
  "\"{b} lost a cow. {a} claims it wandered off. I saw it in {a}'s field last Tuesday, mind.\"",
  "\"Did you hear? {a} has a new hen that lays twice a day. {b} wants to buy it. {a} won't sell.\"",
  "\"{a} and {b} haven't spoken since the harvest feast. Something about a borrowed plough.\"",
  "\"Watch {a}. Nice enough, but they ask a lot of questions about travellers and what they carry.\"",
  "\"{b} has been whistling lately. {a} says it's a lass. {b} says it's the weather. I say it's both.\"",
  "\"The elder had words with {a} over the boundary stones. Nothing came of it. This time.\"",
  "\"{a} has taken to leaving a bowl of milk by the gate. {b} says it's for the fairies. I say it's for the cat.\"",
];
const GOSSIP_ALONE = [
  "\"Not much to tell. Quiet days, and I like them that way.\"",
  "\"There's only the few of us, and we know one another's business already. Nothing's new.\"",
];

const PLACE_BY_TIER: Record<1 | 2 | 3, string[]> = {
  1: [
    "\"{site}? A few roofs and a lot of mud. We keep the fields and the fields keep us.\"",
    "\"Small, quiet, and not much to rob. We like it that way.\"",
  ],
  2: [
    "\"{site} grew up round the green and the market. Good soil, a busy inn, and one more mouth every spring.\"",
    "\"We aren't a town, but we have a mill, a smith and a stubborn priest. That's most of what anyone needs.\"",
  ],
  3: [
    "\"{site} stands behind walls for a reason. Trade comes through the gates, and trouble follows it.\"",
    "\"Plenty of folk pass through, and half of them are thieves. The other half are merchants. Hard to tell which is which.\"",
  ],
};

const AMENITY_PHRASE: Partial<Record<BuildingType, string>> = {
  tavern: "the tavern", church: "the chapel", abbey: "the abbey", blacksmith: "the smithy", bakery: "the bakery", market: "the market",
  mill: "the mill", library: "the scriptorium", hospital: "the infirmary", stables: "the stables", brewery: "the brewery",
  tailor: "the tailor's", granary: "the granary", barn: "the barn", hall: "the hall", barracks: "the barracks", watchtower: "the watchtower",
  keep: "the keep",
};

export function amenityList(types: BuildingType[]): string {
  const seen: string[] = [];
  for (const t of types) { const p = AMENITY_PHRASE[t]; if (p && !seen.includes(p)) seen.push(p); }
  if (seen.length === 0) return "nothing grander than a few houses";
  if (seen.length === 1) return seen[0];
  return seen.slice(0, -1).join(", ") + " and " + seen[seen.length - 1];
}

// The text tokens for one villager, one day. Dialogue text in shared/src/herolife.ts uses {trade} {hello} {work} {craft} {worry}
// {past} {sky} {gossip} {place} {amenities} {elderline}. ({npc}, {site} and {tier} are filled by the server as before.)
export function villagerTokens(ctx: VillagerCtx, tradeId?: string): Record<string, string> {
  const t = villagerTrade(ctx.seed, tradeId);
  const d = ctx.day;
  const bad = foul(ctx.weather);
  const nb = ctx.neighbours;
  const a = nb.length ? pick(nb, ctx.seed + d) : "someone";
  const b = nb.length > 1 ? pick(nb.filter((n) => n !== a), ctx.seed * 3 + d) : "a neighbour";
  const hello = ctx.night ? pick(HELLO_NIGHT, ctx.seed + d) : bad && HELLO_FOUL[ctx.weather] && (ctx.seed + d) % 2 === 0 ? HELLO_FOUL[ctx.weather] : pick(HELLO_DAY, ctx.seed + d);
  const skyPool = SKY[ctx.weather] ?? SKY.clear;
  const sky = ctx.night ? NIGHT_SKY : pick(skyPool, ctx.seed + d) + (ctx.season >= 0 && (ctx.seed + d) % 3 === 0 ? "\n\n" + SEASON_LINE[ctx.season % 4] : "");
  const gossip = nb.length ? pick(GOSSIP, ctx.seed + d * 7).replaceAll("{a}", a).replaceAll("{b}", b) : pick(GOSSIP_ALONE, ctx.seed + d);
  return {
    trade: t.noun,
    hello,
    work: t.work[bad ? 1 : 0],
    craft: t.craft,
    worry: pick(t.worry, ctx.seed + d),
    past: t.past,
    sky,
    gossip,
    place: pick(PLACE_BY_TIER[ctx.tier], ctx.seed + d),
    amenities: amenityList(ctx.amenities),
    elderline: `\"${ctx.elder} keeps the peace and hands out the work. Fair enough, mostly. Talk to them at the keep.\"`,
  };
}
