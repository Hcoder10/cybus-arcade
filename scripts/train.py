"""
Single LoRA SFT script for cybus-arcade. Run on the 8xH200 vast instance.

Usage:
  python scripts/train.py --role scheduler --base Qwen/Qwen3-7B \
      --data datasets/scheduler_traces.jsonl --output checkpoints/scheduler-lora

  python scripts/train.py --role indexer --base Qwen/Qwen3-7B \
      --data datasets/indexer_traces.jsonl --output checkpoints/indexer-lora

  python scripts/train.py --role designer --base Qwen/Qwen3.5-27B \
      --data datasets/designer_traces.jsonl --output checkpoints/designer-lora \
      --freeze-vision-encoder

Then push each LoRA to HF as `squaredcuber/cybus-arcade-{role}-lora` and serve
via vLLM with --enable-lora.
"""

from __future__ import annotations
import os, json, argparse, pathlib, sys, time
import torch
from torch.utils.data import Dataset
from transformers import (AutoTokenizer, AutoModelForCausalLM,
                          TrainingArguments, Trainer)
try:
    from transformers import AutoModelForVision2Seq
except ImportError:
    AutoModelForVision2Seq = AutoModelForCausalLM  # vision not used in 2-LoRA path
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training


class JsonlMessagesDataset(Dataset):
    def __init__(self, path: str, tokenizer, max_len: int = 4096):
        self.examples = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line: continue
                self.examples.append(json.loads(line))
        self.tok = tokenizer
        self.max_len = max_len

    def __len__(self): return len(self.examples)

    def __getitem__(self, i):
        msgs = self.examples[i]["messages"]
        text = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        enc = self.tok(text, truncation=True, max_length=self.max_len,
                       padding="max_length", return_tensors="pt")
        ids = enc.input_ids.squeeze(0)
        attn = enc.attention_mask.squeeze(0)
        # mask non-assistant tokens to -100; train only on assistant outputs
        labels = ids.clone()
        # heuristic: find last "<|im_start|>assistant" token, mask everything before
        text_tokens = self.tok.convert_ids_to_tokens(ids)
        try:
            joined = " ".join(text_tokens)
            asst_idx = joined.rfind("assistant")
            cutoff = len(joined[:asst_idx].split(" "))
            labels[:cutoff] = -100
        except Exception:
            pass
        labels[attn == 0] = -100
        return {"input_ids": ids, "attention_mask": attn, "labels": labels}


def lora_target_modules(model_name: str) -> list[str]:
    if "Qwen" in model_name:
        return ["q_proj","k_proj","v_proj","o_proj",
                "gate_proj","up_proj","down_proj"]
    return ["q_proj","k_proj","v_proj","o_proj"]


def build_model(args):
    is_vision = args.freeze_vision_encoder
    model_cls = AutoModelForVision2Seq if is_vision else AutoModelForCausalLM
    # Don't use device_map='auto' under DDP/torchrun; Trainer handles per-rank placement.
    in_distributed = int(os.environ.get("WORLD_SIZE", "1")) > 1
    load_kwargs = {"torch_dtype": torch.bfloat16, "trust_remote_code": True}
    if not in_distributed:
        load_kwargs["device_map"] = "auto"
    model = model_cls.from_pretrained(args.base, **load_kwargs)
    if is_vision:
        for n, p in model.named_parameters():
            if "vision" in n.lower() or "visual" in n.lower() or "image" in n.lower():
                p.requires_grad = False
    cfg = LoraConfig(
        r=args.rank, lora_alpha=args.alpha, lora_dropout=0.05,
        target_modules=lora_target_modules(args.base),
        bias="none", task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, cfg)
    model.print_trainable_parameters()
    return model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", required=True, choices=["scheduler","indexer","designer"])
    ap.add_argument("--base", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--alpha", type=int, default=128)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--per-device-batch", type=int, default=4)
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--max-len", type=int, default=4096)
    ap.add_argument("--freeze-vision-encoder", action="store_true",
                    help="set for Designer (Qwen3.5-27B multimodal)")
    args = ap.parse_args()

    if args.role == "designer" and not args.freeze_vision_encoder:
        print("[warn] designer should use --freeze-vision-encoder", file=sys.stderr)

    tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    if tok.pad_token is None: tok.pad_token = tok.eos_token

    ds = JsonlMessagesDataset(args.data, tok, max_len=args.max_len)
    print(f"[data] {len(ds)} examples from {args.data}")

    model = build_model(args)

    train_args = TrainingArguments(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.per_device_batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_steps=100,
        bf16=True,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=2,
        gradient_checkpointing=True,
        report_to="none",
        ddp_find_unused_parameters=False,
        # FSDP disabled; 9B+LoRA fits per-H200 (141GB), DDP is sufficient and
        # avoids PEFT auto_wrap_policy issues with Qwen3.5 layer detection.
    )
    try:
        trainer = Trainer(model=model, args=train_args, train_dataset=ds, processing_class=tok)
    except TypeError:
        trainer = Trainer(model=model, args=train_args, train_dataset=ds, tokenizer=tok)
    t0 = time.time()
    trainer.train()
    print(f"[train] done in {(time.time()-t0)/60:.1f} min")
    trainer.save_model(args.output)
    tok.save_pretrained(args.output)
    print(f"[save] adapter at {args.output}")


if __name__ == "__main__":
    main()
