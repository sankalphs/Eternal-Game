"use client";

import { useState } from "react";
import ShadowFight from "@/components/game/ShadowFight";
import StoryIntro from "@/components/game/StoryIntro";

export default function Home() {
  const [showStory, setShowStory] = useState(true);
  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {showStory ? (
        <StoryIntro onFinish={() => setShowStory(false)} />
      ) : (
        <ShadowFight />
      )}
    </div>
  );
}
