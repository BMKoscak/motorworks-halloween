// Phase 3 dialogue: adds the new cast (cinema, film, dyno, drag strip, easter eggs, street reactions) to
// src/data/dialogue.json and writes the ElevenLabs prompts (with eleven_v4 audio tags) used to generate them.
// Usage: node scripts/phase3-lines.mjs [prompts-out.json]
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'src/data/dialogue.json';
const d = JSON.parse(readFileSync(p, 'utf8'));
const V = (name, eleven, elevenVoiceName, demo, fx = 'dry', sapi = 'Microsoft David Desktop') => ({ name, sapi, rate: 0, pitch: 1, fx, eleven, elevenVoiceName, elevenPitch: 1, demo });
Object.assign(d.voices, {
  boxoffice: V('Dusty (Palace Box Office)', 'EMYWJ6jws25NB7xJgDxG', 'Dusty Garner', 'adult_female', 'room', 'Microsoft Zira Desktop'),
  usher: V('Theo (Palace Usher)', 'RhcROc65RG054lfxtUIT', 'Rocky - Storyteller', 'adult_male', 'room'),
  vendor: V('Concession Stand', 'ZQF62XTHtHemfMB0pp0G', 'Shay', 'adult_female', 'room', 'Microsoft Hazel Desktop'),
  projectionist: V('The Projectionist', '1BfrkuYXmEwp8AWqSLWk', 'Declan Graves - Haunted Rasps', 'spirit', 'ghost'),
  narrator: V('Trailer Narrator', '9GVWvaD23xXLseHJlxy8', 'Movie Trailer Voice', 'film', 'film'),
  hero: V('Roxy Steel (Night of the V8)', 'W3C2vBPukr5b5jvoXhPK', 'Kira X - Video Game, Bold & Cinematic', 'film', 'film', 'Microsoft Zira Desktop'),
  villain: V('Count Carburetor (Night of the V8)', 'Vs5CmVCVJwW4odQS2pVf', 'Branok - Evil and Villainous', 'film', 'film'),
  dynotech: V('Gina (Dyno Tech)', 'o9B86nZP8mMLaT5FBEzP', 'Kathie - Sassy & Playful', 'adult_female', 'room', 'Microsoft Zira Desktop'),
  marshal: V('Race Marshal', 'DduhIyyKkOosbP8VefhP', 'David - Sports Arena Announcer', 'adult_male', 'radio'),
  rival: V('Vic Vapor (Rival Racer)', 'sfb7P99ZKEnBPrm3Hqam', 'Rocky Wilson', 'adult_male', 'dry'),
  payphone: V('Voice on the Line', 'qhH5VOAvpCwvNpmn2srO', 'Feagol Dollum - Raspy Whisper', 'spirit', 'radio'),
});
// id: [voice, subtitle text, ElevenLabs prompt with v4 audio tags]
const L = {
  boxoffice_1: ['boxoffice', "Welcome to the Palace! One ticket for Night of the V8? That's eight bucks, hon.", "[warm, cheerful] Welcome to the Palace! One ticket for Night of the V8? That's eight bucks, hon."],
  boxoffice_2: ['boxoffice', 'Enjoy the show. No talking, no texting, and absolutely no revving.', '[playful] Enjoy the show. No talking, no texting... and absolutely no revving.'],
  boxoffice_broke: ['boxoffice', "Eight dollars, sweetie. Come back when your pockets aren't haunted.", "[sympathetic chuckle] Eight dollars, sweetie. Come back when your pockets aren't haunted."],
  usher_1: ['usher', "Ticket? Perfect. Find any seat you like. Mind the steps, they're darker than they look.", "[friendly, quiet] Ticket? Perfect. Find any seat you like. Mind the steps, they're darker than they look."],
  usher_stop: ['usher', 'Whoa, whoa. No ticket, no movie. Box office is out front.', '[firm] Whoa, whoa. No ticket, no movie. Box office is out front.'],
  usher_shh: ['usher', "Shhh! The movie's starting.", "[whispering] Shhh! The movie's starting."],
  concession_1: ['vendor', "One popcorn, extra butter. Careful, it's hot.", "[upbeat] One popcorn, extra butter. Careful, it's hot."],
  projectionist_1: ['projectionist', 'Forty years I ran this projector. Dying was no reason to stop. Enjoy the picture, friend.', '[raspy, slow, haunting] Forty years I ran this projector. Dying was no reason to stop. [pause] Enjoy the picture, friend.'],
  projectionist_2: ['projectionist', 'Do not touch the reels. The last fellow who touched the reels is in row G now. Forever.', '[whispering, ominous] Do not touch the reels. The last fellow who touched the reels... is in row G now. [pause] Forever.'],
  movie_narr_1: ['narrator', 'In a town where the factory never sleeps... one car refused to die.', '[deep, dramatic] In a town where the factory never sleeps... one car refused to die.'],
  movie_hero_1: ['hero', "Something's out there on Hollow Hill Road. And it runs on eight cylinders of pure evil.", "[tense, determined] Something's out there on Hollow Hill Road. And it runs on eight cylinders of pure evil."],
  movie_villain_1: ['villain', "I am Count Carburetor! Your town's horsepower belongs to me!", "[menacing, theatrical] I am Count Carburetor! [evil laugh] Your town's horsepower... belongs to ME!"],
  movie_hero_2: ['hero', 'Then come and take it, Count. My V8 runs on spite and premium unleaded.', '[cocky, confident] Then come and take it, Count. My V8 runs on spite... and premium unleaded.'],
  movie_narr_2: ['narrator', 'This Halloween, the race is on. Night of the V8. Rated R... for revving.', '[epic] This Halloween... the race is on. Night of the V8. [beat] Rated R... for revving.'],
  movie_villain_2: ['villain', "You haven't seen the last of me. I'll be back... for the sequel.", "[sinister whisper] You haven't seen the last of me. [evil chuckle] I'll be back... for the sequel."],
  dyno_1: ['dynotech', "Roll her onto the rollers, nose to the fan. When you're set, press E and floor it.", "[energetic] Roll her onto the rollers, nose to the fan. When you're set, press E and floor it!"],
  dyno_good: ['dynotech', 'Now THAT is horsepower. The rollers are still smoking!', '[excited] Now THAT is horsepower! The rollers are still smoking!'],
  dyno_meh: ['dynotech', 'Not bad, not bad. Bolt on a blower and come back.', '[teasing] Not bad, not bad. Bolt on a blower and come back.'],
  dyno_record: ['dynotech', "New dyno record! I'm putting your name on the wall.", "[thrilled] New dyno record! I'm putting your name on the wall!"],
  shift_start: ['foreman', "Clock's punched. Grab a crate off the pallet at receiving and run it to the station that's flashing. Go, go!", "[gruff, urgent] Clock's punched. Grab a crate off the pallet at receiving and run it to the station that's flashing. Go, go!"],
  shift_done: ['foreman', "That's a shift! Not bad for a rookie. Your pay's in your pocket.", "[satisfied] That's a shift! Not bad for a rookie. Your pay's in your pocket."],
  shift_late: ['foreman', "Too slow, kid! The line can't wait on you.", "[annoyed] Too slow, kid! The line can't wait on you."],
  arcade_hi: ['kiosk', 'New high score! Pumpkin Panic champion detected.', '[robotic, celebratory] New high score! Pumpkin Panic champion detected.'],
  marshal_1: ['marshal', "Racers to the line! Eighth mile, heads up. Watch the tree, and don't jump the green!", "[booming announcer] Racers to the line! Eighth mile, heads up. Watch the tree... and don't jump the green!"],
  marshal_win: ['marshal', 'And the winner by a nose! Somebody check that car for rocket fuel!', '[ecstatic] And the winner by a nose! Somebody check that car for rocket fuel!'],
  marshal_lose: ['marshal', 'Vic Vapor takes it! Better luck next pass.', '[announcer] Vic Vapor takes it! Better luck next pass.'],
  marshal_foul: ['marshal', 'Red light! You jumped the start. That is a foul!', '[disappointed] Red light! You jumped the start. That is a foul!'],
  rival_1: ['rival', "You call that a car? My grandma's hearse has more torque.", "[cocky, smug] You call that a car? My grandma's hearse has more torque."],
  rival_lose: ['rival', 'No way... Rematch! I want a rematch!', '[frustrated] No way... Rematch! I want a rematch!'],
  payphone_1: ['payphone', "Is anyone there? I've been calling for fifty years... Find the clock that strikes thirteen.", "[raspy whisper] Is anyone there? I've been calling for fifty years... [pause] Find the clock that strikes thirteen."],
  payphone_2: ['payphone', "They never found my car. It's still out there on the proving ground... doing eighty-eight.", "[creepy whisper] They never found my car. It's still out there on the proving ground... doing eighty-eight."],
  time88: ['narrator', 'Eighty-eight miles per hour! The flux is fluxing!', '[dramatic, astonished] Eighty-eight miles per hour! The flux is fluxing!'],
  clock13: ['groundskeeper', 'Thirteen bells... The old clock only strikes thirteen when the dead are listening.', '[ominous, slow] Thirteen bells... The old clock only strikes thirteen when the dead are listening.'],
  secret_room: ['dj', "Hey! How'd you find the developers' room? Fine, take the cash. And thanks for playing!", "[surprised, then laughing] Hey! How'd you find the developers' room? Fine, take the cash. And thanks for playing!"],
  konami: ['kiosk', 'Cheat code accepted. Big head mode engaged.', '[robotic] Cheat code accepted. Big head mode... engaged.'],
  honkm_1: ['civ_m', "Hey! I'm walking here!", "[shouting, annoyed] Hey! I'm walking here!"],
  honkm_2: ['civ_m', 'Easy on the horn, pal!', '[irritated] Easy on the horn, pal!'],
  honkf_1: ['civilian', "Do you mind? It's a crosswalk!", "[indignant] Do you mind? It's a crosswalk!"],
  honkf_2: ['civilian', 'Wow. Rude.', '[deadpan] Wow. Rude.'],
  kidb_honk: ['kid_b', 'Hey! Watch it, mister!', '[shouting] Hey! Watch it, mister!'],
  kidg_honk: ['kid_g', 'You almost squished my candy!', '[upset] You almost squished my candy!'],
  rage_m: ['panic_m', 'Hey! You hit my car! Do you know what this costs?', '[angry, shouting] Hey! You hit my car! Do you know what this costs?!'],
  rage_f: ['panic', 'Are you kidding me?! I just got this washed!', '[furious] Are you kidding me?! I just got this washed!'],
  kidb_tot: ['kid_b', 'Trick or treat!', '[excited] Trick or treat!'],
  kidg_tot: ['kid_g', 'Trick or treat! Smell my feet!', '[giggling] Trick or treat! Smell my feet!'],
  homem_candy: ['homeowner_m', 'Well look at you! Here, take two.', '[jolly] Well look at you! Here, take two.'],
  homef_candy: ['homeowner_f', "Aren't you adorable! Happy Halloween, sweetie.", "[sweet] Aren't you adorable! Happy Halloween, sweetie."],
  civm_5: ['civ_m', "Heard they're showing Night of the V8 at the Palace tonight.", "[casual] Heard they're showing Night of the V8 at the Palace tonight."],
  civilian_5: ['civilian', 'Did you see the new traffic lights on Main Street? Fancy.', '[chatty] Did you see the new traffic lights on Main Street? Fancy.'],
};
const prompts = {};
for (const [id, [v, t, pr]] of Object.entries(L)) { d.lines[id] = [v, t]; prompts[id] = { voice: v, voiceId: d.voices[v].eleven, prompt: pr, chars: t.length }; }
writeFileSync(p, JSON.stringify(d, null, 2) + "
");
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(prompts, null, 1));
console.log(Object.keys(L).length, 'lines', Object.values(L).reduce((a, l) => a + l[1].length, 0), 'chars');
