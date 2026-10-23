export function isConfiguredSdkKey(value: string | undefined | null): boolean {
 const key=value?.trim(); return !!key && !/^(your[_-]?|replace[_-]?|changeme|placeholder)/i.test(key);
}
export function isWalletServiceConfigured(key:string|undefined,localRegtest=false):boolean{
 return localRegtest || isConfiguredSdkKey(key);
}