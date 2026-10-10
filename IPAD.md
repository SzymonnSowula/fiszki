# Fiszki jako aplikacja na iPada (.ipa)

Windows nie zbuduje aplikacji iOS, więc robi to darmowy runner macOS na GitHubie.
Hostingu nie potrzebujesz – dostajesz plik Fiszki.ipa, który instalujesz na iPadzie.

## 1. Zbuduj .ipa
1. Załóż konto na github.com i prywatne repozytorium, wrzuć do niego ten folder
   (`git add . && git commit -m init`, `git remote add origin ...`, `git push -u origin master`).
2. Zakładka **Actions → Fiszki iOS (.ipa) → Run workflow** (uruchamia się też przy każdym pushu).
3. Po ~5–10 min pobierz artefakt **Fiszki-ipa** (zip z Fiszki.ipa).

## 2. Zainstaluj na iPadzie (z Windowsa, bez Maca)
Plik jest niepodpisany – podpisuje go Twoje darmowe Apple ID:
- **Sideloadly** (sideloadly.io): podłącz iPada kablem, przeciągnij Fiszki.ipa, wpisz Apple ID, Start.
  Potem na iPadzie: Ustawienia → Ogólne → VPN i zarządzanie urządzeniem → zaufaj swojemu Apple ID.
  (iPad: włącz też Tryb programisty w Ustawienia → Prywatność i bezpieczeństwo.)
- Alternatywa: AltStore.

Darmowe Apple ID = aplikacja wygasa po **7 dniach** – wystarczy ponownie ją zainstalować
przez Sideloadly (dane i talie zostają, jeśli instalujesz na wierzch). Płatne konto
Apple Developer (99 USD/rok) = rok ważności i instalacja przez TestFlight.

## 3. Nauka
Otwórz Fiszki z ekranu początkowego → Wybierz plik → wskaż .apkg w Plikach.
Wszystko działa offline.
