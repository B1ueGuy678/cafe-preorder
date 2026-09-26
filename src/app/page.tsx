import Link from "next/link";
import OrderPicker from "@/components/OrderPicker";
import { getArrivalOptions, getMenu, getShop } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [shop, drinks, options] = await Promise.all([
    getShop(),
    getMenu(),
    getArrivalOptions(),
  ]);

  return (
    <>
      <header className="topbar">
        <h1>{shop.name}</h1>
        <span className="muted">
          营业 {shop.openTime}–{shop.closeTime}
        </span>
      </header>
      <main className="shell">
        <p className="muted" style={{ marginTop: 0 }}>
          路上选好、约个到店时间，到店报手机尾号拿走即可——不用排队，也不用掏手机付款。
        </p>
        <OrderPicker drinks={drinks} options={options} />
        <p className="muted" style={{ textAlign: "center" }}>
          <Link href="/staff" style={{ textDecoration: "underline" }}>
            店员入口
          </Link>
        </p>
      </main>
    </>
  );
}
