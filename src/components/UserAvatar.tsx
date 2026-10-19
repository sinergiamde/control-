import { useState } from "react";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name?: string | null;
  url?: string | null;
  className?: string;
}

/** A user's photo (or their company's logo), falling back to their initial when there's none or
 * the image fails to load. Size comes from className (defaults to 32px). */
const UserAvatar = ({ name, url, className }: UserAvatarProps) => {
  const [failed, setFailed] = useState(false);
  const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
  return (
    <div
      className={cn(
        "w-8 h-8 rounded-full overflow-hidden bg-primary/10 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0",
        className
      )}
    >
      {url && !failed ? (
        <img src={url} alt={name || ""} className="w-full h-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initial
      )}
    </div>
  );
};

export default UserAvatar;
