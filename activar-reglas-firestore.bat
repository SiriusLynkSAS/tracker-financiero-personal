@echo off
echo Publicando reglas Firestore para F-FAC-001...
firebase deploy --only firestore:rules --project tracker-financiero-personal
pause
