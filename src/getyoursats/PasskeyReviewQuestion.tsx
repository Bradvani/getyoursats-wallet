import type {AppLanguage} from '../services/presentationPreferences';

/** A passkey review is knowledge acknowledgement, not recovery verification. */
const copy: Record<AppLanguage, {question: string; unsafe: string; safe: string; wrong: string; right: string}> = {
  en:{question:'Does a synced passkey or email guarantee this wallet can be restored?',unsafe:'Yes, signing in is always enough.',safe:'No. I must check an independent recovery method.',wrong:'Sign-in access is not proof that wallet keys can be recovered.',right:'Correct. A backup must be tested independently.'},
  hi:{question:'क्या सिंक की गई पासकी या ईमेल से वॉलेट रिकवरी की गारंटी है?',unsafe:'हाँ, साइन इन काफी है।',safe:'नहीं। मुझे स्वतंत्र रिकवरी तरीका जाँचना होगा।',wrong:'लॉगिन का ऐक्सेस होना कुंजियाँ रिकवर होने का प्रमाण नहीं है।',right:'सही। बैकअप की अलग से जाँच ज़रूरी है।'},
  es:{question:'¿Una passkey sincronizada o email garantiza la recuperación?',unsafe:'Sí, iniciar sesión siempre es suficiente.',safe:'No. Debo comprobar un método de recuperación independiente.',wrong:'Poder iniciar sesión no prueba que puedas recuperar las claves.',right:'Correcto. Comprueba el backup de forma independiente.'},
  pt:{question:'Uma passkey sincronizada ou email garante recuperar esta carteira?',unsafe:'Sim, iniciar sessão basta sempre.',safe:'Não. Preciso verificar um método de recuperação independente.',wrong:'Entrar na conta não prova que consegues recuperar as chaves.',right:'Correto. Testa o backup separadamente.'},
  ja:{question:'同期したパスキーやメールだけで復元を保証できますか？',unsafe:'はい。ログインできれば十分です。',safe:'いいえ。別の復元方法を検証する必要があります。',wrong:'ログインできてもウォレットの鍵を復元できる証明にはなりません。',right:'正解です。復元方法を別途確認しましょう。'},
  th:{question:'passkey ที่ซิงค์หรืออีเมลรับประกันการกู้คืนกระเป๋าหรือไม่?',unsafe:'ใช่ แค่เข้าสู่ระบบก็พอ',safe:'ไม่ ต้องทดสอบการกู้คืนที่เป็นอิสระ',wrong:'เข้าสู่ระบบได้ไม่ใช่หลักฐานว่ากู้คืนกุญแจได้',right:'ถูกต้อง ทดสอบข้อมูลสำรองแยกต่างหาก'},
  vi:{question:'Passkey đồng bộ hoặc email có đảm bảo khôi phục ví không?',unsafe:'Có. Chỉ cần đăng nhập được.',safe:'Không. Tôi phải kiểm tra phương pháp khôi phục độc lập.',wrong:'Đăng nhập được không chứng minh rằng khóa ví có thể khôi phục.',right:'Đúng. Hãy thử bản sao lưu riêng.'},
  ta:{question:'ஒத்திசைக்கப்பட்ட passkey அல்லது மின்னஞ்சல் மட்டும் பணப்பை மீட்பை உறுதி செய்யுமா?',unsafe:'ஆம். உள்நுழைவு போதும்.',safe:'இல்லை. தனிப்பட்ட மீட்பு முறையைச் சோதிக்க வேண்டும்.',wrong:'உள்நுழைவு அணுகல் விசை மீட்புக்கான சான்று அல்ல.',right:'சரி. காப்புப்பிரதியைத் தனியாகச் சரிபார்.'},
  ar:{question:'هل يضمن مفتاح المرور المتزامن أو البريد استعادة المحفظة؟',unsafe:'نعم، يكفي تسجيل الدخول دائماً.',safe:'لا. يجب اختبار وسيلة استرداد مستقلة.',wrong:'تسجيل الدخول لا يثبت إمكانية استرداد مفاتيح المحفظة.',right:'صحيح. اختبر النسخة الاحتياطية بشكل مستقل.'},
  'zh-CN':{question:'同步通行密钥或电子邮件能保证恢复钱包吗？',unsafe:'能，能登录就足够了。',safe:'不能，必须验证独立恢复方法。',wrong:'能登录不代表能恢复钱包私钥。',right:'正确。需要单独测试恢复备份。'},
};

export function PasskeyReviewQuestion({language, answer, onAnswer}: {
  language: AppLanguage; answer: 'unsafe' | 'safe' | null;
  onAnswer: (value: 'unsafe' | 'safe') => void;
}) {
  const text = copy[language] ?? copy.en;
  return <div className="space-y-2" data-testid="passkey-review-question">
    <p className="text-sm font-semibold text-spark-text-primary">{text.question}</p>
    {(['unsafe','safe'] as const).map(option => <button type="button" key={option}
      aria-pressed={answer === option} onClick={() => onAnswer(option)}
      className={"flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border p-3 text-start text-sm " +
        (answer === option ? 'border-spark-primary bg-spark-surface text-spark-text-primary' : 'border-spark-border bg-spark-dark text-spark-text-secondary')}>
      <span>{text[option]}</span><span aria-hidden="true">{answer === option ? (option === 'safe' ? '✓' : '×') : '○'}</span>
    </button>)}
    {answer && <p className="text-xs leading-relaxed text-spark-text-secondary" role="status">
      {answer === 'safe' ? text.right : text.wrong}
    </p>}
  </div>;
}
