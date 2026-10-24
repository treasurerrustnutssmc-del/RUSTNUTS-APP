Pod::Spec.new do |s|
  s.name           = 'RideComms'
  s.version        = '1.0.0'
  s.summary        = 'Ride comms headset button for the Rustnuts app'
  s.description    = 'Turns the headset play/pause button into mute while ride comms is on.'
  s.license        = 'UNLICENSED'
  s.author         = 'Rustnuts SMC'
  s.homepage       = 'https://rustnutssmc.com.au'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
