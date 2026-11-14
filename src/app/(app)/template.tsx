import { SlideIn } from "@/components/slide-in";

/** Each page animates in when you move between screens. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <SlideIn>{children}</SlideIn>;
}
