export const Avatars = {
  cowboy: require('./avatar-cowboy.png'),
  pirate: require('./avatar-pirate.png'),
  ninja: require('./avatar-ninja.png'),
  wizard: require('./avatar-wizard.png'),
  djFemale: require('./avatar-dj-female.png'),
  pizzaMaker: require('./avatar-pizza-maker.png'),
  owl: require('./avatar-owl.png'),
  bossFemale: require('./avatar-boss-female.png'),
  womanCasual: require('./avatar-woman-casual.png'),
  djMale: require('./avatar-dj-male.png'),
  djFemale2: require('./avatar-dj-female-2.png'),
  spaceFemale: require('./avatar-space-female.png'),
  fox: require('./avatar-fox.png'),
  bossMale: require('./avatar-boss-male.png'),
  pizzaMaker2: require('./avatar-pizza-maker-2.png'),
  superheroFemale: require('./avatar-superhero-female.png'),
} as const;

export type AvatarKey = keyof typeof Avatars;
