/** Matches the centered cream logo and spacing in the email templates. */
export function FormHeader() {
  return (
    <div className="mb-8 flex justify-center">
      <a href="https://pyresauna.com">
        <img
          src="/email/logo-header-creme.png"
          alt="Pyre"
          width={431}
          height={113}
          className="block h-auto w-[100px]"
        />
      </a>
    </div>
  );
}
