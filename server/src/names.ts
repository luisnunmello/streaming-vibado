const ADJECTIVES = [
  'Amber', 'Brave', 'Calm', 'Clever', 'Cosmic', 'Crimson', 'Dizzy', 'Eager', 'Fuzzy', 'Gentle', 'Golden', 'Happy',
  'Hidden', 'Icy', 'Jolly', 'Kind', 'Lazy', 'Lucky', 'Mellow', 'Misty', 'Noble', 'Quiet', 'Rapid', 'Rusty',
  'Silent', 'Sleepy', 'Snowy', 'Sunny', 'Swift', 'Tiny', 'Velvet', 'Wild', 'Witty', 'Zesty',
];
const NOUNS = [
  'Badger', 'Comet', 'Falcon', 'Fox', 'Gecko', 'Heron', 'Iguana', 'Jaguar', 'Koala', 'Lemur', 'Lynx', 'Marmot',
  'Narwhal', 'Otter', 'Panda', 'Parrot', 'Penguin', 'Quokka', 'Raven', 'Salmon', 'Sparrow', 'Tiger', 'Turtle',
  'Walrus', 'Wombat', 'Yak', 'Zebra', 'Moth', 'Owl', 'Whale',
];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** Two random words joined, like "SwiftOtter". */
export function randomNickname(): string {
  return pick(ADJECTIVES) + pick(NOUNS);
}

/** Cleans a nickname typed by a viewer: no control characters, collapsed spaces, at most 24 characters. */
export function cleanNickname(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}
