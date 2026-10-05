Pod::Spec.new do |s|
  s.name           = 'WispraKeyboardBridge'
  s.version        = '1.0.0'
  s.summary        = 'Hands dictated words from the Wispra app to the Wispra keyboard on iPhone'
  s.description    = 'Runs the listening session and hands the words to the Wispra keyboard extension through a shared keychain group.'
  s.license        = 'MIT'
  s.author         = 'Wispra'
  s.homepage       = 'https://github.com/sinhgiang/wispra-mobile'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/sinhgiang/wispra-mobile.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
