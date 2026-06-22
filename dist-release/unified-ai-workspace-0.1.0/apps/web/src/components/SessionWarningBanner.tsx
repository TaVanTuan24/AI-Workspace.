import { ShieldAlert } from "lucide-react";

export function SessionWarningBanner() {
  return (
    <div className="flex gap-3 rounded-md border border-warn/40 bg-amber-50 p-4 text-sm text-amber-950">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p>
        Bạn sẽ đăng nhập trực tiếp trên trang chính thức của provider. Ứng dụng không biết hoặc
        lưu mật khẩu của bạn. Ứng dụng chỉ lưu session đã mã hóa để duy trì đăng nhập. Bạn có thể
        disconnect và xóa session bất cứ lúc nào.
      </p>
    </div>
  );
}
