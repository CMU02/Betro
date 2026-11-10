Pod::Spec.new do |s|
  s.name           = 'CommuteActivity'
  s.version        = '0.0.1'
  s.summary        = 'Commute Live Activity control, token reporting and credentials'
  s.author         = ''
  s.homepage       = 'https://example.invalid'
  s.platforms      = { :ios => '17.2' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
