"use client";

import { useState } from "react";
import EternalGame from "@/components/game/EternalGame";
import StoryIntro from "@/components/game/StoryIntro";

export default function Home() {
  const [showStory, setShowStory] = useState(true);
  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {showStory ? (
        <StoryIntro onFinish={() => setShowStory(false)} />
      ) : (
        <EternalGame />
      )}
    </div>
  );
}
