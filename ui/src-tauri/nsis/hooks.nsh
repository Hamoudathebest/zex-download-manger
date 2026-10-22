!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove only this app's Native Messaging registrations and generated
  ; manifest. Keep Downloads, history, and settings in the app-data folder.
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.downloadmanager.nextgen"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.downloadmanager.nextgen"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\com.downloadmanager.nextgen"
  Delete "$APPDATA\com.zex.downloadmanager\native-host\com.downloadmanager.nextgen.json"
  RMDir "$APPDATA\com.zex.downloadmanager\native-host"
!macroend
