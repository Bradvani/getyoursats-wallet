import SlideInPage from '../components/layout/SlideInPage';
import {usePresentation} from '../hooks/usePresentation';
import {APP_LANGUAGES,setAppLanguage,setAppearancePreference,type AppearancePreference} from '../services/presentationPreferences';

export default function PreferencesPage({kind,onBack}:{kind:'language'|'appearance';onBack:()=>void}) {
  const {language,appearance,copy}=usePresentation();
  return <SlideInPage title={copy[kind]} onClose={onBack} closeStyle="back">
    <fieldset className="gys-preference-page">
      <legend className="sr-only">{copy[kind]}</legend>
      {kind==='language'?APP_LANGUAGES.map(item=><label className="gys-preference-option" key={item.code} data-selected={item.code===language}>
        <span><strong lang={item.code} dir={item.code==='ar'?'rtl':'ltr'}>{item.name}</strong>{item.subtitle&&<small>{item.subtitle}</small>}</span>
        <input type="radio" name="app-language" value={item.code} checked={item.code===language} onChange={()=>setAppLanguage(item.code)}/>
      </label>):(['dark','orange','system'] as const satisfies ReadonlyArray<AppearancePreference>).map(value=><label
        key={value} className="gys-preference-option gys-preference-option--appearance" data-selected={appearance===value}>
        <span className={`gys-appearance-preview gys-appearance-preview--${value}`} aria-hidden="true"><i/><i/><i/></span>
        <strong>{copy[value]}</strong>
        <input type="radio" name="app-appearance" value={value} checked={appearance===value} data-testid={`settings-appearance-${value}`} onChange={()=>setAppearancePreference(value)}/>
      </label>)}
    </fieldset>
  </SlideInPage>;
}
