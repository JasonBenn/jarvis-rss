#!/usr/bin/env bun
/**
 * Classify feeds into categories based on name, URL, and content patterns.
 *
 * Categories:
 * - AI/ML
 * - Tech News & Strategy
 * - Geopolitics & Economics
 * - Rationality & EA
 * - Progress Studies & Science
 * - SF Bay Area & Housing
 * - Comedy & Entertainment
 * - Music & Drums
 * - Personal Growth & Relationships
 * - Writing & Culture
 * - Startups & Business
 * - Engineering & Systems
 * - YouTube Misc
 * - Other
 *
 * Usage: bun scripts/classify-feeds.ts
 */

import * as fs from "fs";

const INPUT_PATH = "scripts/feed-analysis.json";
const OUTPUT_PATH = "scripts/classified-feeds.json";

interface AnalyzedFeed {
  title: string;
  xmlUrl: string;
  existingCategory: string;
  domain: string;
  feedType: string;
  youtubeChannelId?: string;
  resolvedTitle?: string;
  engagement: {
    totalSaved: number;
    totalRead: number;
    sampleReadTitles: string[];
  };
}

interface ClassifiedFeed extends AnalyzedFeed {
  category: string;
  displayTitle: string;  // Use resolvedTitle for YouTube if available
}

// Title-based classification (most reliable)
// Map of exact or partial title matches to categories
const titleToCategory: Record<string, string> = {
  // AI/ML
  "AI Explained": "AI/ML",
  "AI PANIC": "AI/ML",
  "AI Futures Project": "AI/ML",
  "AI Safety Newsletter": "AI/ML",
  "Andrej Karpathy": "AI/ML",
  "Import AI": "AI/ML",
  "AI Alignment": "AI/ML",
  "Cold Takes": "AI/ML",
  "ML Safety Newsletter": "AI/ML",
  "Interconnects": "AI/ML",
  "SemiAnalysis": "AI/ML",
  "The Gradient": "AI/ML",
  "One Useful Thing": "AI/ML",
  "AI as Normal Technology": "AI/ML",
  "Epoch AI": "AI/ML",
  "ThursdAI": "AI/ML",
  "All About AI": "AI/ML",
  "Understanding AI": "AI/ML",
  "The AI Maker": "AI/ML",
  "Artificial Intelligence Made Simple": "AI/ML",
  "Feeling Machines": "AI/ML",
  "Davis Summarizes Papers": "AI/ML",
  "Sparks in the Wind": "AI/ML",
  "Musings on the Alignment Problem": "AI/ML",
  "Cooperative AI Foundation": "AI/ML",
  "The Pond": "AI/ML",
  "AI safety takes": "AI/ML",
  "Redwood Research blog": "AI/ML",
  "Sentinel minutes": "AI/ML",
  "Second Thoughts": "AI/ML",
  "Joe Carlsmith's Substack": "AI/ML",
  "Kanjectures": "AI/ML",
  "Miles's Substack": "AI/ML",
  "Rising Tide": "AI/ML",
  "The EU AI Act Newsletter": "AI/ML",
  "OpenAI": "AI/ML",
  "DeepMind": "AI/ML",
  "DeepMind Blog": "AI/ML",
  "Anthropic": "AI/ML",
  "Neel Nanda": "AI/ML",
  "Ryan Moulton's Articles": "AI/ML",
  "Neurotic Gradient Descent": "AI/ML",
  "Sorta Insightful": "AI/ML",
  "Chat with data": "AI/ML",
  "Connor Shorten": "AI/ML",
  "William's Substack": "AI/ML",
  "Daniel's Substack": "AI/ML",

  // Geopolitics & Economics
  "The Economist explains": "Geopolitics & Economics",
  "Noahpinion": "Geopolitics & Economics",
  "Matt Levine": "Geopolitics & Economics",
  "Net Interest": "Geopolitics & Economics",
  "FA RSS": "Geopolitics & Economics",
  "Leaders": "Geopolitics & Economics",
  "Briefing": "Geopolitics & Economics",
  "The world this week": "Geopolitics & Economics",
  "Slow Boring": "Geopolitics & Economics",
  "ChinaTalk": "Geopolitics & Economics",
  "ChinAI Newsletter": "Geopolitics & Economics",
  "Economic Forces": "Geopolitics & Economics",
  "Dan Wang": "Geopolitics & Economics",
  "How They Make Money": "Geopolitics & Economics",
  "The Cosmopolitan Globalist": "Geopolitics & Economics",
  "Persuasion": "Geopolitics & Economics",
  "Wrong Side of History": "Geopolitics & Economics",
  "Yascha Mounk": "Geopolitics & Economics",
  "Grace Blakeley": "Geopolitics & Economics",
  "Global Guerrillas": "Geopolitics & Economics",
  "FT Alphaville": "Geopolitics & Economics",
  "Cassandra Unchained": "Geopolitics & Economics",
  "How the World Became Rich": "Geopolitics & Economics",
  "Best of Econtwitter": "Geopolitics & Economics",
  "Razib Khan's Unsupervised Learning": "Geopolitics & Economics",
  "Krugman wonks out": "Geopolitics & Economics",
  "Uncharted Territories": "Geopolitics & Economics",
  "Andrew Yang Newsletter": "Geopolitics & Economics",
  "Pete Buttigieg's Substack": "Geopolitics & Economics",
  "Irrational Labs": "Startups & Business",

  // Rationality & EA
  "Astral Codex Ten": "Rationality & EA",
  "LessWrong": "Rationality & EA",
  "Featured posts - LessWrong": "Rationality & EA",
  "Overcoming Bias": "Rationality & EA",
  "Don't Worry About the Vase": "Rationality & EA",
  "Knowingless": "Rationality & EA",
  "Aceso Under Glass": "Rationality & EA",
  "Meteuphoric": "Rationality & EA",
  "Otium": "Rationality & EA",
  "Julia Galef": "Rationality & EA",
  "Luke Muehlhauser": "Rationality & EA",
  "Shtetl-Optimized": "Rationality & EA",
  "Spencer Greenberg": "Rationality & EA",
  "Gwern.net Newsletter": "Rationality & EA",
  "Holly Elmore": "Rationality & EA",
  "Dan Williams": "Rationality & EA",
  "Less Foolish": "Rationality & EA",
  "Minding our way": "Rationality & EA",
  "The Power Law": "Rationality & EA",
  "Rough Diamonds": "Rationality & EA",
  "Rational in the Fullness of Time": "Rationality & EA",
  "world spirit sock stack": "Rationality & EA",
  "Frame Problems": "Rationality & EA",
  "Daniel Schmachtenberger": "Rationality & EA",
  "Guzey's Best of Twitter": "Rationality & EA",
  "The Fox Says": "Rationality & EA",
  "Forethought": "Rationality & EA",
  "ForeWord": "Rationality & EA",
  "More Reasonable": "Rationality & EA",

  // Progress Studies & Science
  "Works in Progress": "Progress Studies & Science",
  "The Works in Progress Newsletter": "Progress Studies & Science",
  "The Roots of Progress": "Progress Studies & Science",
  "Jason Crawford": "Progress Studies & Science",
  "Construction Physics": "Progress Studies & Science",
  "Age of Invention": "Progress Studies & Science",
  "What's New Under the Sun": "Progress Studies & Science",
  "Eli Dourado": "Progress Studies & Science",
  "Institute for Progress": "Progress Studies & Science",
  "Infrastructure – Institute for Progress": "Progress Studies & Science",
  "Longitudinal Science": "Progress Studies & Science",
  "Nintil": "Progress Studies & Science",
  "Maximum Progress": "Progress Studies & Science",
  "Baldwin": "Progress Studies & Science",
  "Building Optimism": "Progress Studies & Science",
  "Nuclear Barbarians": "Progress Studies & Science",
  "3Blue1Brown": "Progress Studies & Science",
  "Veritasium": "Progress Studies & Science",
  "Kurzgesagt – In a Nutshell": "Progress Studies & Science",
  "Punk Rock Bio": "Progress Studies & Science",
  "Essential Technology": "Progress Studies & Science",
  "Biohack the Planet": "Progress Studies & Science",
  "Amateur Technology": "Progress Studies & Science",
  "The Green Dragon": "Progress Studies & Science",
  "Milan Cvitkovic": "Progress Studies & Science",
  "Andy Matuschak": "Progress Studies & Science",
  "Andrew Millison": "Progress Studies & Science",

  // SF Bay Area & Housing
  "GrowSF": "SF Bay Area & Housing",
  "SocketSite™": "SF Bay Area & Housing",
  "Supernuclear": "SF Bay Area & Housing",
  "Better Cities": "SF Bay Area & Housing",
  "Home Economics": "SF Bay Area & Housing",
  "devonzuegel.com": "SF Bay Area & Housing",
  "Thesis Driven": "SF Bay Area & Housing",
  "Urben Field Notes": "SF Bay Area & Housing",
  "Courtyard Urbanist": "SF Bay Area & Housing",
  "Coliving Code": "SF Bay Area & Housing",
  "East Wind Community": "SF Bay Area & Housing",
  "East Wind Community (Sumner's Unofficial Archives)": "SF Bay Area & Housing",
  "Devon's wanderings": "SF Bay Area & Housing",

  // Comedy & Entertainment
  "Comedy Central Stand-Up": "Comedy & Entertainment",
  "Comedy Dynamics": "Comedy & Entertainment",
  "Don't Tell Comedy": "Comedy & Entertainment",
  "Dry Bar Comedy": "Comedy & Entertainment",
  "CollegeHumor": "Comedy & Entertainment",
  "Game Changer Shorts": "Comedy & Entertainment",
  "Channel 5 with Andrew Callaghan": "Comedy & Entertainment",
  "Chris Turner": "Comedy & Entertainment",
  "Dead-Frog": "Comedy & Entertainment",
  "Dave Barry's Substack": "Comedy & Entertainment",
  "ailaughatmyownjokes": "Comedy & Entertainment",
  "Corridor Crew": "Comedy & Entertainment",
  "Girlfriend Reviews": "Comedy & Entertainment",
  "EnterTheDojoShow": "Comedy & Entertainment",
  "Obscurious": "Comedy & Entertainment",
  "Cartoons Hate Her": "Comedy & Entertainment",

  // Music & Drums
  "30 Second Drum Lessons": "Music & Drums",
  "El Estepario Siberiano": "Music & Drums",
  "Daily Drum Lesson": "Music & Drums",
  "DRUMDEX": "Music & Drums",
  "Drew on the Kit": "Music & Drums",
  "Dan Csokmei Drummer": "Music & Drums",
  "Instadailydrum": "Music & Drums",
  "Jacob Collier": "Music & Drums",
  "Dylan Tallchief": "Music & Drums",
  "Ben Prunty": "Music & Drums",
  "gotyemusic": "Music & Drums",
  "hemlocke springs": "Music & Drums",
  "Fäascht Bänkler": "Music & Drums",
  "Ethan teaches you music": "Music & Drums",
  "Adam McDonald": "Music & Drums",

  // Personal Growth & Relationships
  "Sasha's 'Newsletter'": "Personal Growth & Relationships",
  "bookbear express": "Personal Growth & Relationships",
  "Autotranslucence": "Personal Growth & Relationships",
  "Wellness Wisdom by Patricia Mou": "Personal Growth & Relationships",
  "Ask Polly": "Personal Growth & Relationships",
  "Heidi Priebe": "Personal Growth & Relationships",
  "The Last Psychiatrist": "Personal Growth & Relationships",
  "The Last Psychiatrist Archives": "Personal Growth & Relationships",
  "Joyce's Dating Playbook": "Personal Growth & Relationships",
  "Second Person": "Personal Growth & Relationships",
  "Charisma on Command": "Personal Growth & Relationships",
  "Love and Growth with Alyssa": "Personal Growth & Relationships",
  "After Babel": "Personal Growth & Relationships",
  "Tynan.com": "Personal Growth & Relationships",
  "becoming | more myself": "Personal Growth & Relationships",
  "a good omen": "Personal Growth & Relationships",
  "Meaning Society": "Personal Growth & Relationships",
  "A Letter a Day": "Personal Growth & Relationships",
  "Culture Study": "Personal Growth & Relationships",
  "Oliver Burkeman": "Personal Growth & Relationships",
  "The Creative Act": "Personal Growth & Relationships",
  "Building the Builders": "Personal Growth & Relationships",
  "Feeling Tones": "Personal Growth & Relationships",
  "Autopoiesis": "Personal Growth & Relationships",
  "The Cultural Romantic": "Personal Growth & Relationships",
  "Strange Pilgrims": "Personal Growth & Relationships",
  "Misha's Substack": "Personal Growth & Relationships",
  "Higher Ground's Friday Notes": "Personal Growth & Relationships",
  "Seeking Tribe": "Personal Growth & Relationships",
  "Related": "Personal Growth & Relationships",
  "Cheaper Than Divorce": "Personal Growth & Relationships",
  "SlutStack": "Personal Growth & Relationships",
  "skin contact": "Personal Growth & Relationships",
  "velvet noise": "Personal Growth & Relationships",
  "𝓇𝒶𝓌 & 𝒻𝑒𝓇𝒶𝓁": "Personal Growth & Relationships",
  "La La Chimera": "Personal Growth & Relationships",
  "eurydice lives": "Personal Growth & Relationships",
  "Audrey Horne": "Personal Growth & Relationships",
  "Leather & Silk": "Personal Growth & Relationships",
  "Creative Dates": "Personal Growth & Relationships",
  "Authentic Revolution": "Personal Growth & Relationships",
  "Frank Yang": "Personal Growth & Relationships",
  "Bryan Johnson": "Personal Growth & Relationships",
  "Andrew Huberman": "Personal Growth & Relationships",
  "Couple Things": "Personal Growth & Relationships",
  "Hapa Family": "Personal Growth & Relationships",
  "@jasmine": "Personal Growth & Relationships",
  "The Commons": "Personal Growth & Relationships",
  "Delusional": "Personal Growth & Relationships",
  "@saffron": "Personal Growth & Relationships",
  "Bonnie Yu": "Personal Growth & Relationships",
  "booritney": "Personal Growth & Relationships",
  "charli's substack": "Personal Growth & Relationships",
  "Empty Calories": "Personal Growth & Relationships",
  "e-girl esoterica": "Personal Growth & Relationships",
  "cypress and barbells": "Personal Growth & Relationships",
  "Jessica Ocean": "Personal Growth & Relationships",
  "The InnerNet Of Elegance": "Personal Growth & Relationships",
  "Milky": "Personal Growth & Relationships",
  "Untangled": "Personal Growth & Relationships",
  "Numb at the Lodge": "Personal Growth & Relationships",
  "Search Terms": "Personal Growth & Relationships",
  "Thinkgirl's Substack": "Personal Growth & Relationships",
  "Soft Power": "Personal Growth & Relationships",
  "Luke Drago": "Personal Growth & Relationships",
  "ethan's mandates": "Personal Growth & Relationships",
  "The Weird Turn Pro": "Personal Growth & Relationships",

  // Writing & Culture
  "@visakanv's blog": "Writing & Culture",
  "The Electric Typewriter": "Writing & Culture",
  "GK Chesterton - Essays": "Writing & Culture",
  "CS Lewis - Great Essays": "Writing & Culture",
  "On True Friendship": "Writing & Culture",
  "Meaningness": "Writing & Culture",
  "ribbonfarm": "Writing & Culture",
  "The Intrinsic Perspective": "Writing & Culture",
  "thesephist": "Writing & Culture",
  "Nadia Eghbal": "Writing & Culture",
  "Escaping Flatland": "Writing & Culture",
  "The Map is Mostly Water": "Writing & Culture",
  "Res Obscura": "Writing & Culture",
  "Monomythical": "Writing & Culture",
  "Tracing Woodgrains": "Writing & Culture",
  "Narrative Ark": "Writing & Culture",
  "The New Yorker": "Writing & Culture",
  "James Gurney": "Writing & Culture",
  "Forgotten Flicks": "Writing & Culture",
  "The Shadowed Archive": "Writing & Culture",
  "Mind Matters": "Writing & Culture",
  "Nothing Human": "Writing & Culture",
  "Cosmos Institute": "Writing & Culture",
  "Rebuilding Society on Meaning": "Writing & Culture",
  "usefulfictions": "Writing & Culture",
  "yourpublicuniversalfriend": "Writing & Culture",
  "CGP Grey": "Writing & Culture",
  "Altered": "Writing & Culture",
  "The Barrcast": "Writing & Culture",
  "Dialectic": "Writing & Culture",
  "Dad Explains": "Writing & Culture",
  "Fractal Cafe": "Writing & Culture",
  "Jeremy Nixon": "Writing & Culture",
  "Unfolding in the Metacrisis": "Writing & Culture",
  "occasional links posts": "Writing & Culture",
  "Recomendo": "Writing & Culture",
  "Asimov's Addendum": "Writing & Culture",
  "The Science Fictions Podcast": "Writing & Culture",
  "Rosie Campbell": "Writing & Culture",
  "Institute for Meaning Alignment": "Writing & Culture",
  "Rotting the Roots": "Writing & Culture",
  "Cornerstone": "Writing & Culture",
  "Human Readable": "Writing & Culture",
  "Ben Goldhaber's Newsletter": "Writing & Culture",
  "Good Anger": "Writing & Culture",
  "Flight From Perfection": "Writing & Culture",

  // Startups & Business
  "Paul Graham: Essays": "Startups & Business",
  "Sam Altman": "Startups & Business",
  "Andreessen Horowitz": "Startups & Business",
  "a16z": "Startups & Business",
  "a16z American Dynamism": "Startups & Business",
  "Lenny's Newsletter": "Startups & Business",
  "Elizabeth Yin": "Startups & Business",
  "Garry Tan": "Startups & Business",
  "Greylock": "Startups & Business",
  "All-In Podcast": "Startups & Business",
  "Ideas & Musings": "Startups & Business",
  "Talent and Other Things": "Startups & Business",
  "The Argument": "Startups & Business",
  "Baer Necessities": "Startups & Business",
  "Big Technology": "Startups & Business",
  "Creator Economy by Peter Yang": "Startups & Business",
  "Exponential View by Azeem Azhar": "Startups & Business",
  "Marc Andreessen Substack": "Startups & Business",
  "The Leverage": "Startups & Business",
  "next play": "Startups & Business",
  "Speculative": "Startups & Business",
  "The Rebuild": "Startups & Business",
  "Working Assumptions": "Startups & Business",
  "Fakepixels": "Startups & Business",
  "Aarthi and Sriram's Good Time Show": "Startups & Business",
  "Derek Thompson": "Startups & Business",
  "Future": "Startups & Business",

  // Engineering & Systems
  "The Pragmatic Engineer": "Engineering & Systems",
  "ByteByteGo System Design": "Engineering & Systems",
  "Internal Tech Emails": "Engineering & Systems",
  "Google SRE Prodcast": "Engineering & Systems",
  "Brian Douglas": "Engineering & Systems",
  "Ben Katz": "Engineering & Systems",
  "James Bruton": "Engineering & Systems",
  "Bisqwit": "Engineering & Systems",
  "BPS.space": "Engineering & Systems",
  "Brick Technology": "Engineering & Systems",
  "Fix This Build That": "Engineering & Systems",
  "Hello Interview": "Engineering & Systems",
  "Hello Interview - SWE Interview Preparation": "Engineering & Systems",
  "CS153 Infra at Scale": "Engineering & Systems",
  "Curran Kelleher": "Engineering & Systems",
  "Servet Gulnaroglu": "Engineering & Systems",
  "CortexFutura Tools": "Engineering & Systems",
  "Low Level": "Engineering & Systems",
  "Elliott Jin": "Engineering & Systems",
  "Stories by 101 summaries on Medium": "Engineering & Systems",
  "Akiyuki Brick Channel": "Engineering & Systems",
  "Ahmad Bazzi": "Engineering & Systems",
  "Brendan Miller": "Engineering & Systems",

  // More YouTube channels
  "Beast Philanthropy": "Other",
  "Austen Alexander TV": "Other",
  "Isaiah Shinn": "Other",
  "Jacob Acrobat": "Other",
  "Airtable": "Engineering & Systems",
  "Jay and Mark": "Personal Growth & Relationships",
  "Code Fiction": "Engineering & Systems",
  "Dropout": "Comedy & Entertainment",
  "Jer Cooper": "Music & Drums",
  "Jocelyn Stericker": "Other",
  "Joe Edelman": "Writing & Culture",
  "Joe Hudson | Art of Accomplishment": "Personal Growth & Relationships",
  "Joke WRLD": "Comedy & Entertainment",
  "Jungle4eva": "Music & Drums",
  "Kat Stickler": "Comedy & Entertainment",
  "Keenan Crane": "Engineering & Systems",
  "kelogsloops": "Music & Drums",
  "Kendrick Lamar": "Music & Drums",
  "Key & Peele": "Comedy & Entertainment",
  "Key &amp; Peele": "Comedy & Entertainment",
  "Kirby Ferguson": "Writing & Culture",
  "KNOWER MUSIC": "Music & Drums",
  "Kris Temmerman": "Music & Drums",
  "Kye Smith": "Music & Drums",
  "KYLE HANAGAMI": "Music & Drums",
  "Lars Christensen": "Engineering & Systems",
  "louiscolemusic": "Music & Drums",
  "Made with Layers": "Engineering & Systems",
  "Make Some Noise": "Comedy & Entertainment",
  "Marcus House": "Progress Studies & Science",
  "Mark J Kohler": "Startups & Business",
  "Massage Sloth": "Other",
  "Massage Therapeutics": "Other",
  "Matt Rife": "Comedy & Entertainment",
  "Memeable Data": "AI/ML",
  "Matthew Broussard": "Comedy & Entertainment",
  "Meghan & Jack": "Personal Growth & Relationships",
  "Meghan &amp; Jack": "Personal Growth & Relationships",
  "Michael Houck": "Engineering & Systems",
  "Mike Johnston": "Music & Drums",
  "mildlyoverfitted": "AI/ML",
  "Moment of Zen": "Personal Growth & Relationships",
  "Motif Land": "Music & Drums",
  "MovementbyDavid": "Personal Growth & Relationships",
  "My Little Thought Tree": "Personal Growth & Relationships",
  "Myq Kaplan": "Comedy & Entertainment",
  "NateMuellerDrums": "Music & Drums",
  "Nicky Case": "Writing & Culture",
  "Numberphile": "Progress Studies & Science",
  "OK Go": "Music & Drums",
  "Olan Rogers": "Comedy & Entertainment",
  "Pamela Reif": "Personal Growth & Relationships",
  "Paravel": "Engineering & Systems",
  "PASSIONFRUIT SEEDS": "Music & Drums",
  "Patrick Shyu": "Engineering & Systems",
  "Pursuit": "Personal Growth & Relationships",
  "Randy Feltface": "Comedy & Entertainment",
  "Rachel Oates": "Writing & Culture",
  "Robert Glasper": "Music & Drums",
  "Roli Szabo": "Music & Drums",
  "Ron Fundingsland": "Music & Drums",
  "Sam Reich": "Comedy & Entertainment",
  "Sanjay Subrahmanyam": "Geopolitics & Economics",
  "Sebastiano B. Brocchi": "Music & Drums",
  "Simon Gottschalk": "Music & Drums",
  "Smarter Every Day": "Progress Studies & Science",
  "Stand-Up On The Spot": "Comedy & Entertainment",
  "Steve Mould": "Progress Studies & Science",
  "Stuff Made Here": "Engineering & Systems",
  "T. Hobbs": "Music & Drums",
  "Taylor Tomlinson": "Comedy & Entertainment",
  "Technology Connections": "Engineering & Systems",
  "TEDx Talks": "Writing & Culture",
  "The 8-Bit Guy": "Engineering & Systems",
  "The Coding Train": "Engineering & Systems",
  "The Pit with a Comedian": "Comedy & Entertainment",
  "The School of Life": "Personal Growth & Relationships",
  "TheRealNews": "Geopolitics & Economics",
  "ThePrimeagen": "Engineering & Systems",
  "Tom Scott": "Writing & Culture",
  "TomSka": "Comedy & Entertainment",
  "Tony Zhou": "Writing & Culture",
  "Trash Taste": "Other",
  "Two Set Violin": "Music & Drums",
  "Vat19": "Comedy & Entertainment",
  "Vlogbrothers": "Writing & Culture",
  "Wait But Why": "Writing & Culture",
  "Wes Penre": "Other",
  "William Osman": "Engineering & Systems",
  "Wintergatan": "Music & Drums",
  "Wired": "Tech News & Strategy",
  "Zack Freedman": "Engineering & Systems",
  "Ken & Bryn": "Personal Growth & Relationships",
  "Ken &amp; Bryn": "Personal Growth & Relationships",

  // More YouTube misc to categorize
  "Netflix Is A Joke": "Comedy & Entertainment",
  "New Money": "Startups & Business",
  "NewLimit": "Progress Studies & Science",
  "NextUp Comedy": "Comedy & Entertainment",
  "Sam Harris": "Rationality & EA",
  "Two Minute Papers": "AI/ML",
  "The Stoa": "Writing & Culture",
  "Simone Giertz": "Engineering & Systems",
  "Wendover Productions": "Writing & Culture",
  "Nobel Prize": "Progress Studies & Science",
  "Normalized Nerd": "AI/ML",
  "Not Shane Gillis": "Comedy & Entertainment",
  "Ozzy Man Reviews": "Comedy & Entertainment",
  "Paul Millerd": "Personal Growth & Relationships",
  "Peter Draws": "Writing & Culture",
  "Pieter Abbeel": "AI/ML",
  "Praha Drums Official": "Music & Drums",
  "pwnisher": "Engineering & Systems",
  "Rachel Thomas": "AI/ML",
  "Rafael Silva": "Music & Drums",
  "Ralphthebaker": "Other",
  "Rational Animations": "Rationality & EA",
  "RattlemBones": "Music & Drums",
  "raviramamoorthi": "Other",
  "Rebel Wisdom Clips": "Writing & Culture",
  "Red Nomster": "Music & Drums",
  "Reuben Gingrich": "Music & Drums",
  "Rick Glassman": "Comedy & Entertainment",
  "Riff Sesh": "Music & Drums",
  "Rob Burbea Talks": "Personal Growth & Relationships",
  "Robby Cuthbert Design": "Engineering & Systems",
  "Rupert Spira": "Personal Growth & Relationships",
  "Sabine Hossenfelder": "Progress Studies & Science",
  "Salvatore Ganacci": "Music & Drums",
  "Sam Morril": "Comedy & Entertainment",
  "Saturday Night Live": "Comedy & Entertainment",
  "Sean Millea": "Music & Drums",
  "Sheena Melwani": "Music & Drums",
  "Shiatsu Shane": "Other",
  "Shoot From The Hip": "Comedy & Entertainment",
  "Shu Omi": "Personal Growth & Relationships",
  "Siros Vaziri": "Music & Drums",
  "Soulfire": "Music & Drums",
  "Stas Fedechkin": "Music & Drums",
  "Stephen Clark": "Comedy & Entertainment",
  "Strength Side": "Personal Growth & Relationships",
  "Studying With Alex": "Personal Growth & Relationships",
  "SubwayTakes with Kareem Rahma": "Comedy & Entertainment",
  "SysDesign Meetup": "Engineering & Systems",
  "Tech Dummies": "Engineering & Systems",
  "The Basement Yard": "Comedy & Entertainment",
  "The Daily Show": "Comedy & Entertainment",
  "The Diary Of A CEO": "Startups & Business",
  "The Dor Brothers": "Music & Drums",
  "The Hacks Of Life": "Personal Growth & Relationships",
  "The Ready State": "Personal Growth & Relationships",
  "The Slow Mo Guys": "Writing & Culture",
  "Thomas Currier": "Music & Drums",
  "Tom Brown": "Music & Drums",
  "Tom Cardy": "Music & Drums",
  "Tom Merrick": "Personal Growth & Relationships",
  "Track Star*": "Music & Drums",
  "Trip Vest": "Music & Drums",
  "uThermal": "Other",
  "Valve": "Engineering & Systems",
  "vonnart": "Writing & Culture",
  "Watercolor Kanta Harusaki": "Writing & Culture",
  "Web of Stories": "Writing & Culture",
  "Whitney Cummings": "Comedy & Entertainment",
  "Whose Line Is It Anyway?": "Comedy & Entertainment",
  "WorkoutsbyDavid": "Personal Growth & Relationships",
  "Ziwe": "Comedy & Entertainment",

  // Fix "Other" category items
  "Thinking Complete": "Rationality & EA",
  "Blog - Lynette Bye Coaching": "Rationality & EA",
  "Interintellect": "Writing & Culture",
  "Barnacles": "Other",
  "Aarthi and Sriram's  Good Time Show": "Startups & Business",
  "Chalmermagne": "Writing & Culture",
  "Home of the Brave": "Geopolitics & Economics",
  "Following": "Other",
  "News Minimalist daily": "Other",

  // Tech News & Strategy
  "Stratechery": "Tech News & Strategy",
  "🏴‍☠️ Pirate Wires": "Tech News & Strategy",
  "Hacker News: Newest": "Tech News & Strategy",
  "Commonplace - The Commoncog Blog": "Tech News & Strategy",
  "jonstokes.com": "Tech News & Strategy",
  "Remains of the Day": "Tech News & Strategy",
  "Above The Fold": "Tech News & Strategy",
  "The Prompt Report": "Tech News & Strategy",
  "roon's blog": "Tech News & Strategy",
  "the singularity is nearer": "Tech News & Strategy",
  "Programmable Mutter": "Tech News & Strategy",
  "Transformer": "Tech News & Strategy",
  "Random Walk": "Tech News & Strategy",
  "Spectech Newsletter": "Tech News & Strategy",
  "prinz": "Tech News & Strategy",
  "Gray Mirror": "Tech News & Strategy",
  "Dominic Cummings substack": "Tech News & Strategy",
  "Neall's Canvas": "Tech News & Strategy",
  "Concurrent": "Tech News & Strategy",
  "Obsolete": "Tech News & Strategy",
  "No Set Gauge": "Tech News & Strategy",
  "Collective Intelligence Project": "Tech News & Strategy",
  "Dwarkesh Podcast": "Tech News & Strategy",
  "Dwarkesh Patel": "Tech News & Strategy",
  "Posts on Dwarkesh Patel": "Tech News & Strategy",
  "Lex Fridman": "Tech News & Strategy",
  "Eric Weinstein": "Tech News & Strategy",
  "george hotz archive": "Tech News & Strategy",
  "Experience Machines": "Tech News & Strategy",
  "Flack": "Tech News & Strategy",
  "Further Vision": "Tech News & Strategy",
  "Anarchonomicon": "Tech News & Strategy",
  "Chris Painter's Newsletter": "Tech News & Strategy",
  "David's Substack": "Tech News & Strategy",
  "Nan's Substack": "Tech News & Strategy",
  "Thoughts + Things from Jackson Dahl": "Tech News & Strategy",
  "Threading the Needle": "Tech News & Strategy",
  "Michael Nielsen Updates": "Tech News & Strategy",
  "Michael Nielsen": "Tech News & Strategy",
  "Residual Thoughts": "Tech News & Strategy",
  "Chris Lakin's blog": "Tech News & Strategy",
  "Ryan's Substack": "Tech News & Strategy",
  "Sean McClure": "Tech News & Strategy",
  "Justin's Substack": "Tech News & Strategy",
  "pmamtraveller": "Tech News & Strategy",
  "Psychology of Technology Institute": "Tech News & Strategy",
  "Planned Obsolescence": "Tech News & Strategy",
};

// Pattern-based classification rules (used as fallback)
const classificationRules: Array<{
  category: string;
  patterns: RegExp[];
  domains?: string[];
}> = [
  // AI/ML
  {
    category: "AI/ML",
    patterns: [
      /\bai\b/i, /\bml\b/i, /machine learning/i, /artificial intelligence/i,
      /llm/i, /neural/i, /deep learning/i, /alignment/i, /language model/i,
    ],
    domains: [
      "safe.ai", "anthropic.com", "openai.com", "deepmind.com",
      "ai-alignment.com", "alignmentforum.org",
    ],
  },

  // Rationality & EA
  {
    category: "Rationality & EA",
    patterns: [
      /lesswrong/i, /effective altruism/i, /overcoming bias/i,
      /astral codex/i, /slate star/i,
    ],
    domains: [
      "lesswrong.com", "greaterwrong.com", "effectivealtruism.org",
      "slatestarcodex.com", "astralcodexten.com", "overcomingbias.com",
    ],
  },

  // Geopolitics & Economics
  {
    category: "Geopolitics & Economics",
    patterns: [
      /economist/i, /foreign affairs/i, /geopolit/i,
    ],
    domains: [
      "economist.com", "foreignaffairs.com", "bloomberg.com",
    ],
  },
];

function classifyFeed(feed: AnalyzedFeed): string {
  const title = feed.resolvedTitle || feed.title;

  // Check explicit title mapping first (most reliable)
  if (titleToCategory[title]) {
    return titleToCategory[title];
  }

  // Check for partial matches in title mapping
  for (const [knownTitle, category] of Object.entries(titleToCategory)) {
    if (title.toLowerCase().includes(knownTitle.toLowerCase()) ||
        knownTitle.toLowerCase().includes(title.toLowerCase())) {
      return category;
    }
  }

  // Check pattern-based rules as fallback
  for (const rule of classificationRules) {
    // Check domains
    if (rule.domains?.some(d => feed.domain.includes(d))) {
      return rule.category;
    }

    // Check patterns against title only (not sample titles to avoid false matches)
    if (rule.patterns.some(p => p.test(title))) {
      return rule.category;
    }
  }

  // Default categories based on feed type
  if (feed.feedType === "youtube") {
    return "YouTube Misc";
  }

  return "Other";
}

async function main() {
  console.log("Loading feed analysis...");
  const data = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
  const feeds: AnalyzedFeed[] = data.feeds;

  console.log(`Classifying ${feeds.length} feeds...`);

  const classifiedFeeds: ClassifiedFeed[] = feeds.map(feed => ({
    ...feed,
    category: classifyFeed(feed),
    displayTitle: feed.resolvedTitle || feed.title || feed.domain,
  }));

  // Summary
  const categories = new Map<string, number>();
  for (const feed of classifiedFeeds) {
    categories.set(feed.category, (categories.get(feed.category) || 0) + 1);
  }

  console.log("\nCategory distribution:");
  for (const [cat, count] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    totalFeeds: classifiedFeeds.length,
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    feeds: classifiedFeeds,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nOutput written to: ${OUTPUT_PATH}`);

  // Show some examples from each category
  console.log("\nSample feeds per category:");
  for (const [cat] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
    const samples = classifiedFeeds
      .filter(f => f.category === cat)
      .slice(0, 3)
      .map(f => f.displayTitle);
    console.log(`\n${cat}:`);
    for (const s of samples) {
      console.log(`  - ${s}`);
    }
  }
}

main().catch(console.error);
