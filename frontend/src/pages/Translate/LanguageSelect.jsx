export default function LanguageSelect({ value, onChange, languages, includeAuto, detectedLabel }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-600 dark:bg-neutral-800"
    >
      {includeAuto && <option value="auto">{detectedLabel}</option>}
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.name}
        </option>
      ))}
    </select>
  );
}
