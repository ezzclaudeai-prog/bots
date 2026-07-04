// Axiom — greeting bot

const GREETINGS = ['hi', 'hello', 'hey', 'sup', 'yo', 'howdy', 'hiya', 'greetings'];
const BOT_NAME  = 'axiom';

const RESPONSES = [
  `Hey! Axiom here. What can I do for you?`,
  `Hello! Axiom is online and ready.`,
  `Hi there! Axiom at your service.`,
  `Hey, good to see you! Axiom reporting in.`,
  `Greetings! Axiom is listening.`,
];

function isGreeting(text) {
  const lower = text.toLowerCase().trim();
  return GREETINGS.some(g => lower === g || lower === `${g} ${BOT_NAME}` || lower.startsWith(`${g},`));
}

function greet() {
  return RESPONSES[Math.floor(Math.random() * RESPONSES.length)];
}

function handleMessage(text) {
  if (isGreeting(text)) return greet();
  return null;
}

module.exports = { handleMessage, isGreeting, greet };
