const fs = require('fs');
const path = require('path');

const directory = './src/screens';
const files = fs.readdirSync(directory).filter(f => f.endsWith('.tsx'));

files.forEach(file => {
  const filePath = path.join(directory, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if already updated or no SafeAreaView from react-native
  if (content.includes("from 'react-native-safe-area-context'") || !content.includes('SafeAreaView')) {
    return;
  }

  // 1. Remove SafeAreaView from react-native import
  // Handle multiline imports
  content = content.replace(/(\s+)SafeAreaView,?\n?/g, '$1');
  
  // 2. Add SafeAreaView from react-native-safe-area-context
  // Find where react-native is imported
  const rnMatch = content.match(/} from 'react-native';/);
  if (rnMatch) {
    content = content.replace(/} from 'react-native';/, "} from 'react-native';\nimport { SafeAreaView } from 'react-native-safe-area-context';");
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${file}`);
});
