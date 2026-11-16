/**
 * Narration for the ICA 2026 concept video (about six minutes).
 *
 * A beat is one stretch of the video with its own picture. A chunk is one
 * text-to-speech request: `say` is what the voice reads, `style` is how
 * (sent as speech metadata, never spoken), and `captions` are the subtitle
 * lines shown while it plays.
 *
 * `say` differs from the captions only where the voice needs help:
 * "Meeka" makes it say Mika as MEE-ka, numbers are spelled out, and
 * <short pause> is a pause tag the model does not read aloud.
 */
export const MODEL = "gemini-3.8-flash-tts";
export const VOICE = "Sulafat";

/** Prefixed to every chunk's style, so the voice stays one narrator across requests. */
export const BASE_STYLE = "a warm, clear narrator of a short explainer video";

export const BEATS = [
  {
    id: "intro",
    chunks: [
      {
        id: "0a",
        style: "storytelling, drawing the listener in",
        say: "This is a story about handing work to an AI agent, and about taking it back.",
        captions: ["This is a story about handing work to an AI agent,", "and about taking it back."],
      },
      {
        id: "1a",
        style: "friendly and inviting",
        say: "Meet Meeka. She's a software engineer, and today she is handing a job to Kit, her AI coding agent: get release two point four ready to ship.",
        captions: [
          "Meet Mika. She's a software engineer,",
          "and today she is handing a job to Kit, her AI coding agent:",
          "get release 2.4 ready to ship.",
        ],
      },
      {
        id: "1b",
        style: "curious, a little concerned",
        say: "It's one job. But to do it, Kit has to pass through four different applications: the project files, its own memory, a summary service, and a release registry on a blockchain.",
        captions: [
          "It's one job. But to do it,",
          "Kit has to pass through four different applications:",
          "the project files, its own memory,",
          "a summary service, and a release registry on a blockchain.",
        ],
      },
      {
        id: "1c",
        style: "thoughtful, measured, each question distinct",
        say: "So before she lets it go, Meeka wants three answers. <short pause> What may this agent do? <short pause> Until when? <short pause> And if something goes wrong, how do I stop it, right now?",
        captions: [
          "So before she lets it go, Mika wants three answers.",
          "What may this agent do?",
          "Until when?",
          "And if something goes wrong, how do I stop it, right now?",
        ],
      },
    ],
  },
  {
    id: "today",
    chunks: [
      {
        id: "2a",
        style: "matter-of-fact, slightly weary",
        say: "Today, those answers are scattered. Every application keeps its own list of who is allowed. So Meeka grants the same permission four times, in four places.",
        captions: [
          "Today, those answers are scattered.",
          "Every application keeps its own list of who is allowed.",
          "So Mika grants the same permission four times, in four places.",
        ],
      },
      {
        id: "2b",
        style: "uneasy, a note of warning",
        say: "And when the job is done, she has to take it back four times, too. Miss just one list, and the agent keeps a key that nobody remembers.",
        captions: [
          "And when the job is done, she has to take it back four times, too.",
          "Miss just one list,",
          "and the agent keeps a key that nobody remembers.",
        ],
      },
      {
        id: "2c",
        style: "serious, pointing out a risk",
        say: "And an agent is not a careful colleague. One poisoned document can mislead it, and its owner is usually not watching.",
        captions: [
          "And an agent is not a careful colleague.",
          "One poisoned document can mislead it,",
          "and its owner is usually not watching.",
        ],
      },
    ],
  },
  {
    id: "idea",
    chunks: [
      {
        id: "3a",
        style: "bright and hopeful",
        say: "Here is a different idea. Make the permission a thing the agent holds: a token, in the agent's own wallet. It can't be copied, and it can't be passed on.",
        captions: [
          "Here is a different idea.",
          "Make the permission a thing the agent holds:",
          "a token, in the agent's own wallet.",
          "It can't be copied, and it can't be passed on.",
        ],
      },
      {
        id: "3b",
        style: "clear and confident",
        say: "The applications keep no lists at all. Each one declares a single rule: which token opens this door.",
        captions: ["The applications keep no lists at all.", "Each one declares a single rule: which token opens this door."],
      },
      {
        id: "3c",
        style: "crisp and rhythmic, each phrase landing",
        say: "To grant is to mint a token. <short pause> To revoke is to burn it. <short pause> And an expiry is just time.",
        captions: ["To grant is to mint a token.", "To revoke is to burn it.", "And an expiry is just time."],
      },
      {
        id: "3d",
        style: "clear and assured",
        say: "And because the token lives on a public ledger, anyone can check it, and nobody has to run a permission server.",
        captions: [
          "And because the token lives on a public ledger,",
          "anyone can check it,",
          "and nobody has to run a permission server.",
        ],
      },
    ],
  },
  {
    id: "dashboard",
    chunks: [
      {
        id: "4a",
        style: "friendly, showing someone around",
        say: "This is Meeka's dashboard. Everything on it is read live from a public test network; the page itself holds no keys.",
        captions: [
          "This is Mika's dashboard.",
          "Everything on it is read live from a public test network;",
          "the page itself holds no keys.",
        ],
      },
      {
        id: "4b",
        style: "friendly and clear",
        say: "At the top is Meeka herself. Her own authority is a token too: an Employee ID, issued by her employer.",
        captions: ["At the top is Mika herself.", "Her own authority is a token too:", "an Employee ID, issued by her employer."],
      },
      {
        id: "4d",
        style: "clear and helpful",
        say: "Every card names its issuer, says what it opens, and shows how long it lasts.",
        captions: ["Every card names its issuer,", "says what it opens, and shows how long it lasts."],
      },
      {
        id: "4c",
        style: "plain, matter-of-fact",
        say: "Below is Kit. It holds nothing yet. So right now, it can do nothing at all.",
        captions: ["Below is Kit. It holds nothing yet.", "So right now, it can do nothing at all."],
      },
    ],
  },
  {
    id: "grant",
    chunks: [
      {
        id: "5a",
        style: "confident and purposeful",
        say: "Because she holds that Employee ID, Meeka can issue a token of her own. She grants once: one transaction, signed in her own wallet.",
        captions: [
          "Because she holds that Employee ID,",
          "Mika can issue a token of her own.",
          "She grants once: one transaction, signed in her own wallet.",
        ],
      },
      {
        id: "5b",
        style: "pleased, a little excited",
        say: "And there it is. Release assistant, issued by Meeka. Now look at what it opens: two MCP servers, a web API, and a smart contract.",
        captions: [
          "And there it is. Release assistant, issued by Mika.",
          "Now look at what it opens:",
          "two MCP servers, a web API, and a smart contract.",
        ],
      },
      {
        id: "5c",
        style: "warm and emphatic",
        say: "Four applications, run by different people, all accept the same token, because each of them reads the same public ledger. Kit never shows a password or a key. It simply gets to work.",
        captions: [
          "Four applications, run by different people,",
          "all accept the same token,",
          "because each of them reads the same public ledger.",
          "Kit never shows a password or a key.",
          "It simply gets to work.",
        ],
      },
      {
        id: "5d",
        style: "light and brisk, counting things off",
        say: "The files. <short pause> The memory. <short pause> The summary service. <short pause> The registry. One by one, the doors open.",
        captions: ["The files. The memory.", "The summary service. The registry.", "One by one, the doors open."],
      },
    ],
  },
  {
    id: "pass",
    chunks: [
      {
        id: "6a",
        style: "upbeat and informative",
        say: "Meeka isn't the only one who can issue. For the deployment, her employer's operations team adds a token of its own: a production pass that lasts thirty minutes.",
        captions: [
          "Mika isn't the only one who can issue.",
          "For the deployment, her employer's operations team",
          "adds a token of its own:",
          "a production pass that lasts thirty minutes.",
        ],
      },
      {
        id: "6b",
        style: "calm and reassuring",
        say: "A different issuer, in the same wallet. And the two share no administrator.",
        captions: ["A different issuer, in the same wallet.", "And the two share no administrator."],
      },
    ],
  },
  {
    id: "expiry",
    chunks: [
      {
        id: "6c",
        style: "calm, lightly amused",
        say: "And when the time is up, nobody has to do anything. No transaction is sent. <short pause> The pass simply stops working, and Kit is told why.",
        captions: [
          "And when the time is up, nobody has to do anything.",
          "No transaction is sent.",
          "The pass simply stops working, and Kit is told why.",
        ],
      },
      {
        id: "6d",
        style: "calm, a little impressed",
        say: "The agent doesn't try again. It reports back, and waits.",
        captions: ["The agent doesn't try again.", "It reports back, and waits."],
      },
    ],
  },
  {
    id: "burn",
    chunks: [
      {
        id: "7a",
        style: "tense and serious",
        say: "Now, something goes wrong. Kit reads a file with hidden instructions inside, and starts drifting away from its task.",
        captions: [
          "Now, something goes wrong.",
          "Kit reads a file with hidden instructions inside,",
          "and starts drifting away from its task.",
        ],
      },
      {
        id: "7b",
        style: "calm and decisive",
        say: "Meeka doesn't need to argue with it. She doesn't need its cooperation. She burns the one token she issued.",
        captions: ["Mika doesn't need to argue with it.", "She doesn't need its cooperation.", "She burns the one token she issued."],
      },
      {
        id: "7c",
        style: "relieved and emphatic",
        say: "And every door closes. The MCP servers, the web API, the contract: all four at once, at their very next check.",
        captions: ["And every door closes.", "The MCP servers, the web API, the contract:", "all four at once, at their very next check."],
      },
      {
        id: "7d",
        style: "satisfied and measured, slowing down",
        say: "She granted once. <short pause> She revoked once. <short pause> Everywhere.",
        captions: ["She granted once.", "She revoked once.", "Everywhere."],
      },
      {
        id: "7e",
        style: "calm and matter-of-fact",
        say: "Whether Kit cooperates or not makes no difference. The check happens at the door.",
        captions: ["Whether Kit cooperates or not makes no difference.", "The check happens at the door."],
      },
    ],
  },
  {
    id: "issuers",
    chunks: [
      {
        id: "8a",
        style: "expansive and optimistic",
        say: "And the issuer can be anyone a door chooses to trust. In another office, an accountant's agents hold tokens from her employer, from a tax agency, from her manager, and even from another AI agent, handing a short task to a helper.",
        captions: [
          "And the issuer can be anyone a door chooses to trust.",
          "In another office, an accountant's agents hold tokens",
          "from her employer, from a tax agency, from her manager,",
          "and even from another AI agent,",
          "handing a short task to a helper.",
        ],
      },
      {
        id: "8b",
        style: "confident",
        say: "Each issuer mints and burns its own tokens. Each application decides which ones it accepts. Nobody shares a database, and nobody shares an administrator.",
        captions: [
          "Each issuer mints and burns its own tokens.",
          "Each application decides which ones it accepts.",
          "Nobody shares a database,",
          "and nobody shares an administrator.",
        ],
      },
      {
        id: "8c",
        style: "confident, summing up",
        say: "A token issued in one organization is honored in another. All they share is the ledger.",
        captions: ["A token issued in one organization is honored in another.", "All they share is the ledger."],
      },
    ],
  },
  {
    id: "recap",
    chunks: [
      {
        id: "9a",
        style: "warm and reflective",
        say: "So, back to Meeka's three questions. What may this agent do? Until when? And how do I stop it?",
        captions: ["So, back to Mika's three questions.", "What may this agent do? Until when?", "And how do I stop it?"],
      },
      {
        id: "9b",
        style: "warm and conclusive, speaking slowly",
        say: "Every answer is a token you can see, issued by someone you can name. <short pause> Grant once. <short pause> Revoke everywhere.",
        captions: ["Every answer is a token you can see,", "issued by someone you can name.", "Grant once. Revoke everywhere."],
      },
      {
        id: "9c",
        style: "friendly, looking ahead",
        say: "Next: does it hold up when we measure it?",
        captions: ["Next: does it hold up when we measure it?"],
      },
    ],
  },
];
