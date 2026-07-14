import localFont from "next/font/local";

export const display = localFont({
  src: "./fonts/AnimalsAreLikePeople.ttf",
  variable: "--font-display",
  display: "swap",
});

export const hand = localFont({
  src: "./fonts/PatrickHand-Regular.ttf",
  variable: "--font-hand",
  display: "swap",
});
