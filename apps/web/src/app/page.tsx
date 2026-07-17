import { getSurvivors } from "@/lib/api";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { SignInCta } from "@/components/front-page/signin-cta";

export default async function Home() {
  const data = await getSurvivors({ sort: "time", page: 1 }).catch(() => null);
  return (
    <main className="mx-auto w-full max-w-5xl">
      <Hero />
      <TopSurvivors rows={data?.rows.slice(0, 5) ?? []} />
      <SignInCta />
    </main>
  );
}
