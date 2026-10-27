export default function UnavailableWalletAction({title,onBack}:{title:string;onBack:()=>void}){
 return <main className="min-h-dvh flex items-center justify-center bg-spark-dark px-4 py-8 text-spark-text-primary">
  <section className="w-full max-w-md space-y-4 rounded-2xl border border-spark-border bg-spark-surface p-6">
   <h1 className="text-xl font-bold">{title}</h1>
   <p role="status">This action is temporarily unavailable in this preview. No transaction has been submitted.</p>
   <p className="text-sm text-spark-text-secondary">Keep your recovery words and existing wallet data. You can return to your balance and payment history.</p>
   <button type="button" onClick={onBack} className="min-h-12 w-full rounded-xl bg-spark-primary px-4 font-semibold text-black">Back to wallet</button>
  </section>
 </main>;
}
