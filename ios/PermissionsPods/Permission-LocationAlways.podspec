Pod::Spec.new do |s|
  s.name         = 'Permission-LocationAlways'
  s.version      = '1.0.0'
  s.summary      = 'RNPermissions LocationAlways handler (vendor)'
  s.homepage     = 'https://github.com/zoontek/react-native-permissions'
  s.license      = { :type => 'MIT' }
  s.authors      = { 'RNPermissions' => 'noreply@example.com' }
  s.platforms    = { :ios => '12.4' }
  s.source       = { :git => 'https://github.com/zoontek/react-native-permissions.git', :tag => 'v5.4.4' }
  s.source_files = '../../node_modules/react-native-permissions/ios/LocationAlways/*.{h,mm}'
  s.requires_arc = true
  if ENV['RCT_NEW_ARCH_ENABLED'] == '1'
    # rely on autolinking
  else
    s.dependency 'React-Core'
  end
end
